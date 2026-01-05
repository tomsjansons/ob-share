/**
 * Tool Step - Step for executing local tools
 *
 * Tools are reusable functions that can perform actions like
 * file I/O, API calls, database operations, etc.
 */

import { z } from "zod";
import type {
  ToolStepConfig,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolParameter,
  ToolLogger,
  StepResult,
  WorkflowContext,
} from "../types";
import { BaseStep, type StepExecutionContext } from "./base-step";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "tool-step" });

/**
 * Tool registry - stores all registered tools
 */
class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool
   */
  register<TInput = unknown, TOutput = unknown>(
    tool: ToolDefinition<TInput, TOutput>
  ): void {
    if (this.tools.has(tool.name)) {
      logger.warn(
        { event: "tool.registry.overwrite", toolName: tool.name },
        "Overwriting existing tool"
      );
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    logger.debug(
      { event: "tool.registered", toolName: tool.name },
      "Tool registered"
    );
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tools
   */
  getAll(): Map<string, ToolDefinition> {
    return new Map(this.tools);
  }

  /**
   * Get all tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.category === category
    );
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

export const ToolRegistry = new ToolRegistryImpl();

/**
 * Tool Step implementation
 */
export class ToolStep extends BaseStep<ToolStepConfig> {
  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext, stepRecord, signal } = ctx;
    const toolName = this.config.toolName;

    // Get the tool
    const tool = ToolRegistry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
        shouldRetry: false,
      };
    }

    try {
      // Resolve input
      const input = this.resolveInput(this.config.input, workflowContext);

      // Validate input if schema is provided
      if (tool.inputSchema) {
        const parseResult = tool.inputSchema.safeParse(input);
        if (!parseResult.success) {
          return {
            success: false,
            error: `Invalid tool input: ${parseResult.error.message}`,
            shouldRetry: false,
          };
        }
      }

      logger.debug(
        {
          event: "tool.call.start",
          stepId: this.id,
          toolName,
        },
        "Starting tool execution"
      );

      // Create tool context
      const toolContext: ToolContext = {
        workflowId: workflowContext.metadata.workflowId,
        stepId: stepRecord.id,
        userId: undefined, // TODO: Add user context
        signal,
        logger: createToolLogger(this.id, toolName),
      };

      // Execute tool
      const result = await tool.execute(input, toolContext);

      // Validate output if schema is provided
      if (result.success && tool.outputSchema && result.output !== undefined) {
        const parseResult = tool.outputSchema.safeParse(result.output);
        if (!parseResult.success) {
          logger.warn(
            {
              event: "tool.output.validation_error",
              stepId: this.id,
              toolName,
              error: parseResult.error.message,
            },
            "Tool output validation failed"
          );
          // Still return success, but log the warning
        }
      }

      logger.debug(
        {
          event: "tool.call.complete",
          stepId: this.id,
          toolName,
          success: result.success,
        },
        "Tool execution completed"
      );

      if (result.success) {
        return {
          success: true,
          output: {
            result: result.output,
            metadata: result.metadata,
          },
        };
      } else {
        return {
          success: false,
          error: result.error ?? "Tool execution failed",
          shouldRetry: true,
        };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "tool.call.error",
          stepId: this.id,
          toolName,
          err,
        },
        "Tool execution threw an error"
      );

      return {
        success: false,
        error,
        shouldRetry: true,
      };
    }
  }

  /**
   * Resolve input from static value or function
   */
  private resolveInput(
    input:
      | Record<string, unknown>
      | ((context: WorkflowContext) => Record<string, unknown>),
    context: WorkflowContext
  ): Record<string, unknown> {
    if (typeof input === "function") {
      return input(context);
    }

    // Deep clone and resolve any template variables
    return this.resolveTemplateVariables(input, context);
  }

  /**
   * Recursively resolve template variables in an object
   */
  private resolveTemplateVariables(
    obj: Record<string, unknown>,
    context: WorkflowContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.resolveTemplateString(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? this.resolveTemplateVariables(
                item as Record<string, unknown>,
                context
              )
            : typeof item === "string"
              ? this.resolveTemplateString(item, context)
              : item
        );
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.resolveTemplateVariables(
          value as Record<string, unknown>,
          context
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Resolve template variables in a string
   */
  private resolveTemplateString(
    template: string,
    context: WorkflowContext
  ): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = getNestedValue(context, path.trim());
      return value !== undefined ? String(value) : match;
    });
  }
}

/**
 * Helper to create a tool step config
 */
export function defineToolStep(
  config: Omit<ToolStepConfig, "type">
): ToolStepConfig {
  return {
    ...config,
    type: "tool-call",
  };
}

/**
 * Helper to define a tool
 */
export function defineTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return definition;
}

/**
 * Create a tool logger
 */
function createToolLogger(stepId: string, toolName: string): ToolLogger {
  const toolLogger = logger.child({ stepId, toolName });

  return {
    debug: (msg, data) =>
      toolLogger.debug({ event: "tool.log.debug", ...data }, msg),
    info: (msg, data) =>
      toolLogger.info({ event: "tool.log.info", ...data }, msg),
    warn: (msg, data) =>
      toolLogger.warn({ event: "tool.log.warn", ...data }, msg),
    error: (msg, data) =>
      toolLogger.error({ event: "tool.log.error", ...data }, msg),
  };
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// =============================================================================
// Common Tool Schemas
// =============================================================================

/**
 * Common input/output schemas for tools
 */
export const ToolSchemas = {
  /**
   * File path input
   */
  filePath: z.object({
    path: z.string().describe("File path"),
  }),

  /**
   * File content output
   */
  fileContent: z.object({
    content: z.string(),
    path: z.string(),
    size: z.number().optional(),
    mimeType: z.string().optional(),
  }),

  /**
   * HTTP request input
   */
  httpRequest: z.object({
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    timeout: z.number().optional(),
  }),

  /**
   * HTTP response output
   */
  httpResponse: z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.unknown(),
  }),

  /**
   * Generic key-value input
   */
  keyValue: z.object({
    key: z.string(),
    value: z.unknown(),
  }),

  /**
   * Generic list output
   */
  list: <T extends z.ZodSchema>(itemSchema: T) =>
    z.object({
      items: z.array(itemSchema),
      total: z.number(),
    }),

  /**
   * Success/failure result
   */
  result: z.object({
    success: z.boolean(),
    message: z.string().optional(),
  }),

  /**
   * Text processing input
   */
  textInput: z.object({
    text: z.string(),
    options: z.record(z.unknown()).optional(),
  }),

  /**
   * Text processing output
   */
  textOutput: z.object({
    text: z.string(),
    metadata: z.record(z.unknown()).optional(),
  }),
};

// =============================================================================
// Built-in Tool Definitions
// =============================================================================

/**
 * Echo tool - for testing
 */
export const echoTool = defineTool({
  name: "echo",
  description: "Echoes back the input (for testing)",
  category: "testing",
  parameters: [
    {
      name: "message",
      type: "string",
      description: "Message to echo",
      required: true,
    },
  ],
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  execute: async (input) => {
    return {
      success: true,
      output: { echoed: input.message },
    };
  },
});

/**
 * Delay tool - for testing async behavior
 */
export const delayTool = defineTool({
  name: "delay",
  description: "Waits for a specified duration (for testing)",
  category: "testing",
  parameters: [
    {
      name: "ms",
      type: "number",
      description: "Milliseconds to wait",
      required: true,
    },
  ],
  inputSchema: z.object({ ms: z.number().min(0).max(60000) }),
  outputSchema: z.object({ waited: z.number() }),
  execute: async (input, context) => {
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, input.ms);
      context.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Delay cancelled"));
      });
    });
    return {
      success: true,
      output: { waited: Date.now() - start },
    };
  },
});

/**
 * Random number tool
 */
export const randomTool = defineTool({
  name: "random",
  description: "Generates a random number",
  category: "utility",
  parameters: [
    { name: "min", type: "number", description: "Minimum value", required: false },
    { name: "max", type: "number", description: "Maximum value", required: false },
  ],
  inputSchema: z.object({
    min: z.number().default(0),
    max: z.number().default(1),
  }),
  outputSchema: z.object({ value: z.number() }),
  execute: async (input) => {
    const min = input.min ?? 0;
    const max = input.max ?? 1;
    const value = Math.random() * (max - min) + min;
    return {
      success: true,
      output: { value },
    };
  },
});

/**
 * JSON parse tool
 */
export const jsonParseTool = defineTool({
  name: "json-parse",
  description: "Parses a JSON string",
  category: "data",
  parameters: [
    { name: "json", type: "string", description: "JSON string to parse", required: true },
  ],
  inputSchema: z.object({ json: z.string() }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async (input) => {
    try {
      const data = JSON.parse(input.json);
      return { success: true, output: { data } };
    } catch (err) {
      return {
        success: false,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * JSON stringify tool
 */
export const jsonStringifyTool = defineTool({
  name: "json-stringify",
  description: "Converts data to JSON string",
  category: "data",
  parameters: [
    { name: "data", type: "object", description: "Data to stringify", required: true },
    { name: "pretty", type: "boolean", description: "Pretty print", required: false },
  ],
  inputSchema: z.object({
    data: z.unknown(),
    pretty: z.boolean().default(false),
  }),
  outputSchema: z.object({ json: z.string() }),
  execute: async (input) => {
    const json = input.pretty
      ? JSON.stringify(input.data, null, 2)
      : JSON.stringify(input.data);
    return { success: true, output: { json } };
  },
});

/**
 * Register built-in tools
 */
export function registerBuiltInTools(): void {
  ToolRegistry.register(echoTool);
  ToolRegistry.register(delayTool);
  ToolRegistry.register(randomTool);
  ToolRegistry.register(jsonParseTool);
  ToolRegistry.register(jsonStringifyTool);
}
