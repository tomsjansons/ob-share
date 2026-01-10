/**
 * Base Step - Abstract base class for workflow steps
 *
 * All step types extend this base class which provides common
 * functionality for step execution, retries, and error handling.
 */

import type {
  BaseStepConfig,
  StepConfig,
  StepResult,
  StepStatus,
  StepType,
  StepRetryConfig,
  StepCondition,
  WorkflowContext,
  StepExecutionRecord,
} from "../types";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "workflow-step" });

/**
 * Default retry configuration
 */
export const DEFAULT_STEP_RETRY_CONFIG: Required<StepRetryConfig> = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
};

/**
 * Default step timeout (5 minutes)
 */
export const DEFAULT_STEP_TIMEOUT = 300000;

/**
 * Context passed to step execution
 */
export interface StepExecutionContext<TTrigger = unknown> {
  workflowContext: WorkflowContext<TTrigger>;
  stepRecord: StepExecutionRecord;
  signal: AbortSignal;
  previousOutput?: unknown;
}

/**
 * Abstract base class for all step types
 */
export abstract class BaseStep<TConfig extends BaseStepConfig = BaseStepConfig> {
  protected readonly config: TConfig;
  protected readonly retryConfig: Required<StepRetryConfig>;
  protected readonly timeout: number;

  constructor(config: TConfig) {
    this.config = config;
    this.retryConfig = {
      ...DEFAULT_STEP_RETRY_CONFIG,
      ...config.retryConfig,
    };
    this.timeout = config.timeout ?? DEFAULT_STEP_TIMEOUT;
  }

  /**
   * Get the step ID
   */
  get id(): string {
    return this.config.id;
  }

  /**
   * Get the step name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get the step type
   */
  get type(): StepType {
    return this.config.type;
  }

  /**
   * Get the step description
   */
  get description(): string | undefined {
    return this.config.description;
  }

  /**
   * Check if step should run based on condition
   */
  shouldRun(context: WorkflowContext): boolean {
    const condition = this.config.condition;
    if (!condition) {
      return true;
    }

    // Use function if provided
    if (condition.evaluate) {
      try {
        return condition.evaluate(context);
      } catch (err) {
        logger.error(
          {
            event: "step.condition.error",
            stepId: this.id,
            err,
          },
          "Error evaluating step condition"
        );
        return false;
      }
    }

    // Use expression if provided
    if (condition.expression) {
      try {
        return evaluateConditionExpression(condition.expression, context);
      } catch (err) {
        logger.error(
          {
            event: "step.condition.expression_error",
            stepId: this.id,
            expression: condition.expression,
            err,
          },
          "Error evaluating step condition expression"
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Execute the step with retry logic
   */
  async executeWithRetry(ctx: StepExecutionContext): Promise<StepResult> {
    let lastError: string | undefined;
    let attempt = 0;

    while (attempt <= this.retryConfig.maxRetries) {
      // Check for cancellation
      if (ctx.signal.aborted) {
        return {
          success: false,
          error: "Step execution cancelled",
          shouldRetry: false,
        };
      }

      try {
        // Apply timeout to execution
        const result = await this.executeWithTimeout(ctx);

        if (result.success || !result.shouldRetry) {
          return result;
        }

        lastError = result.error;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            event: "step.execution.error",
            stepId: this.id,
            attempt,
            err,
          },
          "Step execution threw an error"
        );
      }

      attempt++;

      // If we have more retries, wait with backoff
      if (attempt <= this.retryConfig.maxRetries) {
        const backoffMs = Math.min(
          this.retryConfig.backoffMs * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxBackoffMs
        );

        logger.info(
          {
            event: "step.retry.scheduled",
            stepId: this.id,
            attempt,
            backoffMs,
          },
          "Scheduling step retry"
        );

        await sleep(backoffMs);
      }
    }

    return {
      success: false,
      error: lastError ?? "Step failed after all retries",
      shouldRetry: false,
    };
  }

  /**
   * Execute with timeout wrapper
   */
  private async executeWithTimeout(ctx: StepExecutionContext): Promise<StepResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Step execution timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.execute(ctx)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }

  /**
   * Abstract method to be implemented by subclasses
   */
  abstract execute(ctx: StepExecutionContext): Promise<StepResult>;

  /**
   * Get a serializable representation of the step config
   */
  toJSON(): TConfig {
    return { ...this.config };
  }
}

/**
 * Evaluate a condition expression against the workflow context.
 *
 * SECURITY NOTE: This uses the Function constructor which is similar to eval().
 * Security is maintained through the following assumptions:
 *
 * 1. Expressions come from trusted workflow definitions, NOT user input
 * 2. Workflow definitions are loaded from code/config, not runtime data
 * 3. The context object is a copy with only safe properties exposed
 * 4. Expressions are sandboxed to only access the destructured context values
 *
 * If expressions need to come from untrusted sources in the future,
 * consider using a safe expression evaluator library like expr-eval or jexl.
 *
 * @param expression - A JavaScript expression string from a trusted source
 * @param context - The workflow context to evaluate against
 * @returns The boolean result of the expression
 */
export function evaluateConditionExpression(
  expression: string,
  context: WorkflowContext
): boolean {
  // Create a safe evaluation context - only expose safe properties
  const evalContext = {
    trigger: context.trigger,
    variables: context.variables,
    stepOutputs: context.stepOutputs,
    metadata: context.metadata,
  };

  const fn = new Function(
    "context",
    `
    const { trigger, variables, stepOutputs, metadata } = context;
    return Boolean(${expression});
  `
  );

  return fn(evalContext);
}

/**
 * Create a step condition from an expression
 */
export function createCondition(expression: string): StepCondition {
  return { expression };
}

/**
 * Create a step condition from a function
 */
export function createConditionFn(
  evaluate: (context: WorkflowContext) => boolean
): StepCondition {
  return { evaluate };
}

/**
 * Helper to create step configurations
 */
export function defineStep<T extends StepConfig>(config: T): T {
  return config;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type guard for step types
 */
export function isStepType<T extends StepConfig>(
  step: StepConfig,
  type: StepType
): step is T {
  return step.type === type;
}
