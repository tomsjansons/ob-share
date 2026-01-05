/**
 * Decision Step - LLM-driven step selection
 *
 * Uses an LLM to evaluate the current context and decide
 * which step(s) to execute next.
 */

import { z } from "zod";
import type {
  DecisionStepConfig,
  DecisionOption,
  LLMConfig,
  LLMMessage,
  StepResult,
  WorkflowContext,
} from "../types";
import { BaseStep, type StepExecutionContext } from "./base-step";
import { DEFAULT_LLM_CONFIG, getLLMProvider } from "./llm-step";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "decision-step" });

/**
 * Decision output schema
 */
const DecisionOutputSchema = z.object({
  selectedOptions: z.array(z.string()),
  reasoning: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type DecisionOutput = z.infer<typeof DecisionOutputSchema>;

/**
 * Decision Step implementation
 */
export class DecisionStep extends BaseStep<DecisionStepConfig> {
  private llmConfig: LLMConfig;

  constructor(config: DecisionStepConfig, defaultConfig?: Partial<LLMConfig>) {
    super(config);
    this.llmConfig = {
      ...DEFAULT_LLM_CONFIG,
      ...defaultConfig,
      ...config.llmConfig,
    };
  }

  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext, signal } = ctx;

    try {
      // Build the decision prompt
      const userPrompt = this.buildDecisionPrompt(workflowContext);

      // Get LLM provider
      const provider = getLLMProvider(this.llmConfig.provider);
      if (!provider) {
        return {
          success: false,
          error: `Unknown LLM provider: ${this.llmConfig.provider}`,
          shouldRetry: false,
        };
      }

      const messages: LLMMessage[] = [
        {
          role: "system",
          content: this.getSystemPrompt(),
        },
        {
          role: "user",
          content: userPrompt,
        },
      ];

      logger.debug(
        {
          event: "decision.call.start",
          stepId: this.id,
          optionCount: this.config.options.length,
        },
        "Starting decision LLM call"
      );

      // Make LLM call
      const response = await provider.call(messages, this.llmConfig, {
        structuredOutput: {
          schema: DecisionOutputSchema,
          name: "make_decision",
          description: "Select the next step(s) to execute",
        },
        signal,
      });

      // Parse the decision
      let decision: DecisionOutput;
      try {
        decision = DecisionOutputSchema.parse(JSON.parse(response.content));
      } catch (err) {
        logger.warn(
          {
            event: "decision.parse.error",
            stepId: this.id,
            response: response.content,
            err,
          },
          "Failed to parse decision output"
        );
        return {
          success: false,
          error: `Failed to parse decision: ${err instanceof Error ? err.message : String(err)}`,
          shouldRetry: true,
        };
      }

      // Validate selected options
      const validOptionIds = this.config.options.map((o) => o.id);
      const invalidSelections = decision.selectedOptions.filter(
        (id) => !validOptionIds.includes(id)
      );

      if (invalidSelections.length > 0) {
        logger.warn(
          {
            event: "decision.invalid_selection",
            stepId: this.id,
            invalidSelections,
            validOptions: validOptionIds,
          },
          "LLM selected invalid options"
        );
        return {
          success: false,
          error: `Invalid option selection: ${invalidSelections.join(", ")}`,
          shouldRetry: true,
        };
      }

      // Check if multiple selections are allowed
      if (!this.config.allowMultiple && decision.selectedOptions.length > 1) {
        logger.warn(
          {
            event: "decision.multiple_not_allowed",
            stepId: this.id,
            selections: decision.selectedOptions,
          },
          "Multiple selections not allowed"
        );
        // Take only the first selection
        decision.selectedOptions = [decision.selectedOptions[0]];
      }

      // Collect next step IDs
      const nextStepIds: string[] = [];
      for (const optionId of decision.selectedOptions) {
        const option = this.config.options.find((o) => o.id === optionId);
        if (option) {
          if (Array.isArray(option.nextStepId)) {
            nextStepIds.push(...option.nextStepId);
          } else {
            nextStepIds.push(option.nextStepId);
          }
        }
      }

      logger.info(
        {
          event: "decision.made",
          stepId: this.id,
          selectedOptions: decision.selectedOptions,
          nextStepIds,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
        },
        "Decision made"
      );

      return {
        success: true,
        output: {
          decision,
          selectedOptions: decision.selectedOptions,
        },
        nextStepIds,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "decision.error",
          stepId: this.id,
          err,
        },
        "Decision step failed"
      );

      return {
        success: false,
        error,
        shouldRetry: true,
      };
    }
  }

  /**
   * Get the system prompt for decision making
   */
  private getSystemPrompt(): string {
    const allowMultiple = this.config.allowMultiple ? "You may select multiple options if appropriate." : "Select exactly one option.";

    return `You are a decision-making agent. Your task is to analyze the given context and select the most appropriate next step(s) from the available options.

${allowMultiple}

Consider the following when making your decision:
1. The current state and variables in the workflow
2. The goal or purpose implied by the context
3. The descriptions of each available option
4. Any previous step outputs that may be relevant

Provide your decision in the structured format requested.`;
  }

  /**
   * Build the user prompt for decision
   */
  private buildDecisionPrompt(context: WorkflowContext): string {
    // Resolve the prompt template
    const basePrompt = this.resolvePrompt(context);

    // Build options description
    const optionsDescription = this.config.options
      .map((opt) => `- ${opt.id}: ${opt.name} - ${opt.description}`)
      .join("\n");

    // Build context summary
    const contextSummary = this.buildContextSummary(context);

    return `${basePrompt}

## Current Context
${contextSummary}

## Available Options
${optionsDescription}

Based on the context above, which option(s) should be selected next?`;
  }

  /**
   * Resolve the prompt template
   */
  private resolvePrompt(context: WorkflowContext): string {
    const prompt = this.config.prompt;

    if (typeof prompt === "function") {
      return prompt(context);
    }

    // Template variable substitution
    return prompt.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = getNestedValue(context, path.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Build a summary of the workflow context
   */
  private buildContextSummary(context: WorkflowContext): string {
    const parts: string[] = [];

    // Trigger data
    if (context.trigger) {
      parts.push(
        `**Trigger Data:**\n\`\`\`json\n${JSON.stringify(context.trigger, null, 2)}\n\`\`\``
      );
    }

    // Variables
    if (Object.keys(context.variables).length > 0) {
      parts.push(
        `**Variables:**\n\`\`\`json\n${JSON.stringify(context.variables, null, 2)}\n\`\`\``
      );
    }

    // Recent step outputs (last 3)
    const stepOutputs = Object.entries(context.stepOutputs);
    if (stepOutputs.length > 0) {
      const recentOutputs = stepOutputs.slice(-3);
      const outputsText = recentOutputs
        .map(
          ([stepId, output]) =>
            `- ${stepId}: ${JSON.stringify(output).slice(0, 200)}...`
        )
        .join("\n");
      parts.push(`**Recent Step Outputs:**\n${outputsText}`);
    }

    // Execution path
    if (context.metadata.executionPath.length > 0) {
      parts.push(
        `**Execution Path:** ${context.metadata.executionPath.join(" → ")}`
      );
    }

    return parts.join("\n\n");
  }
}

/**
 * Helper to create a decision step config
 */
export function defineDecisionStep(
  config: Omit<DecisionStepConfig, "type">
): DecisionStepConfig {
  return {
    ...config,
    type: "decision",
  };
}

/**
 * Helper to create a decision option
 */
export function defineDecisionOption(option: DecisionOption): DecisionOption {
  return option;
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
