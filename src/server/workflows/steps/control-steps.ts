/**
 * Control Steps - Control flow steps for workflows
 *
 * Includes parallel execution, transforms, conditions, and loops.
 */

import type {
  ParallelStepConfig,
  TransformStepConfig,
  ConditionStepConfig,
  LoopStepConfig,
  StepResult,
  WorkflowContext,
} from "../types";
import { BaseStep, type StepExecutionContext, evaluateConditionExpression } from "./base-step";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "control-steps" });

// =============================================================================
// Parallel Step
// =============================================================================

/**
 * Parallel Step - Executes multiple steps concurrently
 *
 * Note: The actual parallel execution is handled by the orchestrator.
 * This step just signals which steps should run in parallel.
 */
export class ParallelStep extends BaseStep<ParallelStepConfig> {
  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    // The parallel step itself doesn't execute anything directly.
    // It returns the list of step IDs to execute in parallel.
    // The orchestrator handles the actual parallel execution.

    logger.debug(
      {
        event: "parallel.start",
        stepId: this.id,
        parallelSteps: this.config.steps,
      },
      "Parallel step executed"
    );

    return {
      success: true,
      output: {
        parallelSteps: this.config.steps,
        waitForAll: this.config.waitForAll ?? true,
        failFast: this.config.failFast ?? true,
      },
      nextStepIds: this.config.steps,
    };
  }
}

/**
 * Helper to create a parallel step config
 */
export function defineParallelStep(
  config: Omit<ParallelStepConfig, "type">
): ParallelStepConfig {
  return {
    ...config,
    type: "parallel",
  };
}

// =============================================================================
// Transform Step
// =============================================================================

/**
 * Transform Step - Transforms data without LLM calls
 *
 * Useful for data manipulation, aggregation, or formatting.
 */
export class TransformStep extends BaseStep<TransformStepConfig> {
  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext } = ctx;

    try {
      logger.debug(
        {
          event: "transform.start",
          stepId: this.id,
        },
        "Starting transform"
      );

      // Execute the transform function (await in case it's async)
      const output = await this.config.transform(workflowContext);

      logger.debug(
        {
          event: "transform.complete",
          stepId: this.id,
        },
        "Transform completed"
      );

      // If outputKey is specified, return as variables
      if (this.config.outputKey) {
        return {
          success: true,
          output,
          variables: {
            [this.config.outputKey]: output,
          },
        };
      }

      return {
        success: true,
        output,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "transform.error",
          stepId: this.id,
          err,
        },
        "Transform failed"
      );

      return {
        success: false,
        error,
        shouldRetry: false, // Transform errors are usually not retryable
      };
    }
  }
}

/**
 * Helper to create a transform step config
 */
export function defineTransformStep(
  config: Omit<TransformStepConfig, "type">
): TransformStepConfig {
  return {
    ...config,
    type: "transform",
  };
}

// =============================================================================
// Condition Step
// =============================================================================

/**
 * Condition Step - Conditional branching
 *
 * Evaluates a condition and routes to different steps.
 */
export class ConditionStep extends BaseStep<ConditionStepConfig> {
  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext } = ctx;

    try {
      logger.debug(
        {
          event: "condition.start",
          stepId: this.id,
        },
        "Evaluating condition"
      );

      // Evaluate the condition
      let conditionResult = false;
      const condition = this.config.condition;

      if (condition.evaluate) {
        conditionResult = condition.evaluate(workflowContext);
      } else if (condition.expression) {
        conditionResult = evaluateConditionExpression(
          condition.expression,
          workflowContext
        );
      }

      // Determine next step
      const nextStepId = conditionResult
        ? this.config.thenStepId
        : this.config.elseStepId;

      logger.debug(
        {
          event: "condition.complete",
          stepId: this.id,
          conditionResult,
          nextStepId,
        },
        "Condition evaluated"
      );

      return {
        success: true,
        output: {
          conditionResult,
          branch: conditionResult ? "then" : "else",
        },
        nextStepIds: nextStepId ? [nextStepId] : [],
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "condition.error",
          stepId: this.id,
          err,
        },
        "Condition evaluation failed"
      );

      return {
        success: false,
        error,
        shouldRetry: false,
      };
    }
  }
}

/**
 * Helper to create a condition step config
 */
export function defineConditionStep(
  config: Omit<ConditionStepConfig, "type">
): ConditionStepConfig {
  return {
    ...config,
    type: "condition",
  };
}

// =============================================================================
// Loop Step
// =============================================================================

/**
 * Loop Step - Iterative execution over a collection
 *
 * Iterates over items and executes a body step for each.
 * Note: Actual iteration is managed by the orchestrator.
 */
export class LoopStep extends BaseStep<LoopStepConfig> {
  async execute(ctx: StepExecutionContext): Promise<StepResult> {
    const { workflowContext } = ctx;

    try {
      // Get the items to iterate over
      const items = workflowContext.variables[this.config.itemsKey] as unknown[];

      if (!Array.isArray(items)) {
        return {
          success: false,
          error: `Loop items not found or not an array: ${this.config.itemsKey}`,
          shouldRetry: false,
        };
      }

      // Check max iterations
      const maxIterations = this.config.maxIterations ?? Infinity;
      const itemCount = Math.min(items.length, maxIterations);

      logger.debug(
        {
          event: "loop.start",
          stepId: this.id,
          itemCount,
          maxIterations,
        },
        "Starting loop"
      );

      // The loop step returns the iteration info
      // The orchestrator handles the actual iteration
      return {
        success: true,
        output: {
          items: items.slice(0, itemCount),
          itemKey: this.config.itemKey,
          bodyStepId: this.config.bodyStepId,
          totalItems: items.length,
          iterationCount: itemCount,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "loop.error",
          stepId: this.id,
          err,
        },
        "Loop setup failed"
      );

      return {
        success: false,
        error,
        shouldRetry: false,
      };
    }
  }
}

/**
 * Helper to create a loop step config
 */
export function defineLoopStep(
  config: Omit<LoopStepConfig, "type">
): LoopStepConfig {
  return {
    ...config,
    type: "loop",
  };
}

// =============================================================================
// Step Factory
// =============================================================================

import type { StepConfig, StepType } from "../types";
import type { LLMConfig } from "../types";
import { LLMStep } from "./llm-step";
import { ToolStep } from "./tool-step";
import { DecisionStep } from "./decision-step";

/**
 * Create a step instance from config
 */
export function createStep(
  config: StepConfig,
  defaultLLMConfig?: Partial<LLMConfig>
): BaseStep {
  switch (config.type) {
    case "llm-call":
      return new LLMStep(config, defaultLLMConfig);
    case "tool-call":
      return new ToolStep(config);
    case "decision":
      return new DecisionStep(config, defaultLLMConfig);
    case "parallel":
      return new ParallelStep(config);
    case "transform":
      return new TransformStep(config);
    case "condition":
      return new ConditionStep(config);
    case "loop":
      return new LoopStep(config);
    default:
      throw new Error(`Unknown step type: ${(config as StepConfig).type}`);
  }
}
