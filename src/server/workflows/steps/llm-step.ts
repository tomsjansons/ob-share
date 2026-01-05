/**
 * LLM Step - Step for making LLM API calls
 *
 * Supports multiple LLM providers, structured output via Zod schemas,
 * and tool use within LLM calls.
 */

import { z } from "zod";
import type {
  LLMStepConfig,
  LLMConfig,
  LLMMessage,
  LLMResponse,
  LLMStructuredOutput,
  StepResult,
  WorkflowContext,
} from "../types";
import { BaseStep, type StepExecutionContext } from "./base-step";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "llm-step" });

/**
 * Default LLM configuration
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  temperature: 0.7,
  maxTokens: 4096,
  timeout: 120000, // 2 minutes
};

/**
 * LLM Provider interface for abstraction
 */
export interface LLMProvider {
  name: string;
  call(
    messages: LLMMessage[],
    config: LLMConfig,
    options?: LLMCallOptions
  ): Promise<LLMResponse>;
}

/**
 * Options for LLM calls
 */
export interface LLMCallOptions {
  structuredOutput?: LLMStructuredOutput;
  tools?: LLMToolDefinition[];
  signal?: AbortSignal;
}

/**
 * Tool definition for LLM tool use
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema;
}

/**
 * Tool call from LLM
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Extended LLM response with tool calls
 */
export interface LLMResponseWithTools extends LLMResponse {
  toolCalls?: LLMToolCall[];
}

/**
 * Anthropic provider implementation
 */
export class AnthropicProvider implements LLMProvider {
  name = "anthropic";

  async call(
    messages: LLMMessage[],
    config: LLMConfig,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }

    const baseUrl = config.baseUrl ?? "https://api.anthropic.com";

    // Separate system message from user/assistant messages
    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Build request body
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      messages: conversationMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    // Handle structured output via tool use
    if (options?.structuredOutput) {
      const schema = options.structuredOutput.schema;
      const jsonSchema = zodToJsonSchema(schema);

      body.tools = [
        {
          name: options.structuredOutput.name ?? "structured_response",
          description:
            options.structuredOutput.description ??
            "Provide a structured response",
          input_schema: jsonSchema,
        },
      ];
      body.tool_choice = {
        type: "tool",
        name: options.structuredOutput.name ?? "structured_response",
      };
    }

    // Make API request
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    const data = await response.json();

    // Parse response
    let content = "";
    const toolCalls: LLMToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    // For structured output, extract from tool call
    if (options?.structuredOutput && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      content = JSON.stringify(toolCall.arguments);
    }

    return {
      content,
      model: data.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
      finishReason: data.stop_reason,
      raw: data,
    };
  }
}

/**
 * OpenAI-compatible provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  name = "openai";

  async call(
    messages: LLMMessage[],
    config: LLMConfig,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";

    // Build request body
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    // Handle structured output
    if (options?.structuredOutput) {
      const schema = options.structuredOutput.schema;
      const jsonSchema = zodToJsonSchema(schema);

      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.structuredOutput.name ?? "response",
          schema: jsonSchema,
          strict: true,
        },
      };
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content ?? "",
      model: data.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      finishReason: choice?.finish_reason,
      raw: data,
    };
  }
}

/**
 * Provider registry
 */
const providers: Map<string, LLMProvider> = new Map([
  ["anthropic", new AnthropicProvider()],
  ["openai", new OpenAIProvider()],
]);

/**
 * Register a custom LLM provider
 */
export function registerLLMProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Get an LLM provider by name
 */
export function getLLMProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}

/**
 * LLM Step implementation
 */
export class LLMStep extends BaseStep<LLMStepConfig> {
  private provider: LLMProvider;
  private llmConfig: LLMConfig;

  constructor(config: LLMStepConfig, defaultConfig?: Partial<LLMConfig>) {
    super(config);

    // Merge LLM configs
    this.llmConfig = {
      ...DEFAULT_LLM_CONFIG,
      ...defaultConfig,
      ...config.llmConfig,
    };

    // Get provider
    const provider = getLLMProvider(this.llmConfig.provider);
    if (!provider) {
      throw new Error(`Unknown LLM provider: ${this.llmConfig.provider}`);
    }
    this.provider = provider;
  }

  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext, stepRecord, signal } = ctx;

    try {
      // Build messages
      const messages: LLMMessage[] = [];

      // System prompt
      const systemPrompt = this.resolveTemplate(
        this.config.systemPrompt,
        workflowContext
      );
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }

      // User prompt
      const userPrompt = this.resolveTemplate(
        this.config.userPrompt,
        workflowContext
      );
      messages.push({ role: "user", content: userPrompt });

      logger.debug(
        {
          event: "llm.call.start",
          stepId: this.id,
          provider: this.llmConfig.provider,
          model: this.llmConfig.model,
          messageCount: messages.length,
        },
        "Starting LLM call"
      );

      // Make LLM call
      const response = await this.provider.call(messages, this.llmConfig, {
        structuredOutput: this.config.structuredOutput,
        signal,
      });

      logger.debug(
        {
          event: "llm.call.complete",
          stepId: this.id,
          usage: response.usage,
          finishReason: response.finishReason,
        },
        "LLM call completed"
      );

      // Parse structured output if configured
      let output: unknown = response.content;
      if (this.config.structuredOutput) {
        try {
          const parsed = JSON.parse(response.content);
          output = this.config.structuredOutput.schema.parse(parsed);
        } catch (err) {
          logger.warn(
            {
              event: "llm.structured_output.parse_error",
              stepId: this.id,
              err,
            },
            "Failed to parse structured output"
          );
          return {
            success: false,
            error: `Failed to parse structured output: ${err instanceof Error ? err.message : String(err)}`,
            shouldRetry: true,
          };
        }
      }

      return {
        success: true,
        output: {
          content: output,
          usage: response.usage,
          model: response.model,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "llm.call.error",
          stepId: this.id,
          err,
        },
        "LLM call failed"
      );

      // Determine if should retry
      const shouldRetry = this.isRetryableError(err);

      return {
        success: false,
        error,
        shouldRetry,
      };
    }
  }

  /**
   * Resolve a template string or function
   */
  private resolveTemplate(
    template: string | ((context: WorkflowContext) => string) | undefined,
    context: WorkflowContext
  ): string {
    if (!template) {
      return "";
    }

    if (typeof template === "function") {
      return template(context);
    }

    // Simple template variable substitution
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = getNestedValue(context, path.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(err: unknown): boolean {
    if (!(err instanceof Error)) {
      return true;
    }

    const message = err.message.toLowerCase();

    // Rate limit errors are retryable
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }

    // Server errors are retryable
    if (message.includes("500") || message.includes("502") || message.includes("503")) {
      return true;
    }

    // Network errors are retryable
    if (message.includes("network") || message.includes("timeout") || message.includes("econnreset")) {
      return true;
    }

    // Auth errors are not retryable
    if (message.includes("401") || message.includes("403") || message.includes("api key")) {
      return false;
    }

    // Default to retryable
    return true;
  }
}

/**
 * Helper to create an LLM step config
 */
export function defineLLMStep(
  config: Omit<LLMStepConfig, "type">
): LLMStepConfig {
  return {
    ...config,
    type: "llm-call",
  };
}

/**
 * Get a nested value from an object using dot notation
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

/**
 * Convert a Zod schema to JSON Schema (simplified version)
 */
function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
  // This is a simplified implementation
  // For production, use a library like zod-to-json-schema
  const zodType = (schema as z.ZodTypeAny)._def;

  if (zodType.typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodSchema);
      if (!(value as z.ZodTypeAny).isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (zodType.typeName === "ZodString") {
    return { type: "string" };
  }

  if (zodType.typeName === "ZodNumber") {
    return { type: "number" };
  }

  if (zodType.typeName === "ZodBoolean") {
    return { type: "boolean" };
  }

  if (zodType.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(zodType.type),
    };
  }

  if (zodType.typeName === "ZodEnum") {
    return {
      type: "string",
      enum: zodType.values,
    };
  }

  if (zodType.typeName === "ZodOptional") {
    return zodToJsonSchema(zodType.innerType);
  }

  if (zodType.typeName === "ZodNullable") {
    const inner = zodToJsonSchema(zodType.innerType);
    return {
      ...inner,
      nullable: true,
    };
  }

  // Default fallback
  return { type: "string" };
}

/**
 * Common Zod schemas for LLM outputs
 */
export const LLMOutputSchemas = {
  /**
   * Simple text output
   */
  text: z.object({
    text: z.string(),
  }),

  /**
   * Yes/no decision
   */
  yesNo: z.object({
    answer: z.enum(["yes", "no"]),
    reasoning: z.string().optional(),
  }),

  /**
   * Classification result
   */
  classification: <T extends string>(categories: readonly T[]) =>
    z.object({
      category: z.enum(categories as [T, ...T[]]),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
    }),

  /**
   * List of items
   */
  list: <T extends z.ZodSchema>(itemSchema: T) =>
    z.object({
      items: z.array(itemSchema),
    }),

  /**
   * Key-value extraction
   */
  extraction: <T extends z.ZodRawShape>(shape: T) => z.object(shape),

  /**
   * Summary output
   */
  summary: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()).optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  }),

  /**
   * Action decision
   */
  action: <T extends string>(actions: readonly T[]) =>
    z.object({
      action: z.enum(actions as [T, ...T[]]),
      parameters: z.record(z.unknown()).optional(),
      reasoning: z.string().optional(),
    }),
};
