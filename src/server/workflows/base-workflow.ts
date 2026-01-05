/**
 * Base Workflow - Abstract base class for defining workflows
 *
 * Provides a structured way to define workflows with steps, transitions,
 * and lifecycle hooks. Supports both class-based and functional definitions.
 */

import { z } from "zod";
import type {
  WorkflowDefinition,
  StepConfig,
  StepTransition,
  WorkflowPriority,
  LLMConfig,
  WorkflowInstance,
  WorkflowContext,
  StepCondition,
} from "./types";
import { WorkflowPriority as Priority } from "./types";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "base-workflow" });

/**
 * Abstract base class for workflow definitions
 */
export abstract class BaseWorkflow<TTrigger = unknown, TResult = unknown>
  implements WorkflowDefinition<TTrigger, TResult>
{
  abstract readonly id: string;
  abstract readonly name: string;
  description?: string;
  version?: string;
  defaultPriority?: WorkflowPriority;
  defaultTimeout?: number;

  // Schema for validating trigger data
  triggerSchema?: z.ZodSchema<TTrigger>;

  // Schema for validating result data
  resultSchema?: z.ZodSchema<TResult>;

  // Default LLM configuration
  defaultLLMConfig?: Partial<LLMConfig>;

  // Private steps storage
  private _steps: Map<string, StepConfig> | null = null;
  private _transitions: StepTransition[] | null = null;
  private _entryStepId: string | null = null;

  /**
   * Get the steps map (lazy initialization)
   */
  get steps(): Map<string, StepConfig> {
    if (!this._steps) {
      this._steps = this.initializeSteps();
    }
    return this._steps;
  }

  /**
   * Get the transitions (lazy initialization)
   */
  get transitions(): StepTransition[] {
    if (!this._transitions) {
      this._transitions = this.defineTransitions();
    }
    return this._transitions;
  }

  /**
   * Get the entry step ID (lazy initialization)
   */
  get entryStepId(): string {
    if (!this._entryStepId) {
      this._entryStepId = this.getEntryStep();
    }
    return this._entryStepId;
  }

  /**
   * Define the workflow steps
   * Override this method to define your workflow steps
   */
  protected abstract defineSteps(): StepConfig[];

  /**
   * Get the entry step ID
   * Override to specify a custom entry step
   */
  protected abstract getEntryStep(): string;

  /**
   * Define transitions between steps
   * Override to define custom transitions
   * Default returns an empty array (use step-defined nextStepIds)
   */
  protected defineTransitions(): StepTransition[] {
    return [];
  }

  /**
   * Initialize steps into a map
   */
  private initializeSteps(): Map<string, StepConfig> {
    const stepsArray = this.defineSteps();
    const stepsMap = new Map<string, StepConfig>();

    for (const step of stepsArray) {
      if (stepsMap.has(step.id)) {
        logger.warn(
          { workflowId: this.id, stepId: step.id },
          "Duplicate step ID in workflow"
        );
      }
      stepsMap.set(step.id, step);
    }

    return stepsMap;
  }

  /**
   * Validate trigger data
   */
  validateTrigger(trigger: unknown): trigger is TTrigger {
    if (!this.triggerSchema) {
      return true; // No validation if no schema
    }

    try {
      this.triggerSchema.parse(trigger);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate result data
   */
  validateResult(result: unknown): result is TResult {
    if (!this.resultSchema) {
      return true;
    }

    try {
      this.resultSchema.parse(result);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a step by ID
   */
  getStep(stepId: string): StepConfig | undefined {
    return this.steps.get(stepId);
  }

  /**
   * Get all step IDs
   */
  getStepIds(): string[] {
    return Array.from(this.steps.keys());
  }

  /**
   * Get the next step IDs from transitions
   */
  getNextStepIds(
    currentStepId: string,
    context: WorkflowContext
  ): string[] | null {
    // Check explicit transitions first
    const relevantTransitions = this.transitions.filter(
      (t) => t.from === currentStepId
    );

    if (relevantTransitions.length === 0) {
      return null; // No explicit transitions, use step-defined nextStepIds
    }

    const nextStepIds: string[] = [];

    for (const transition of relevantTransitions) {
      // Check condition if present
      if (transition.condition) {
        let conditionResult = false;

        if (transition.condition.evaluate) {
          conditionResult = transition.condition.evaluate(context);
        } else if (transition.condition.expression) {
          try {
            conditionResult = evaluateExpression(
              transition.condition.expression,
              context
            );
          } catch {
            conditionResult = false;
          }
        }

        if (!conditionResult) {
          continue;
        }
      }

      // Add the next step(s)
      if (Array.isArray(transition.to)) {
        nextStepIds.push(...transition.to);
      } else {
        nextStepIds.push(transition.to);
      }
    }

    return nextStepIds;
  }

  /**
   * Lifecycle hook: Called when workflow starts
   */
  async onStart?(instance: WorkflowInstance): Promise<void>;

  /**
   * Lifecycle hook: Called when workflow completes successfully
   */
  async onComplete?(instance: WorkflowInstance, result: TResult): Promise<void>;

  /**
   * Lifecycle hook: Called when workflow fails
   */
  async onFailed?(instance: WorkflowInstance, error: string): Promise<void>;

  /**
   * Lifecycle hook: Called when a step completes
   */
  async onStepComplete?(
    instance: WorkflowInstance,
    step: { id: string; name: string; output: unknown }
  ): Promise<void>;

  /**
   * Convert to a plain definition object
   */
  toDefinition(): WorkflowDefinition<TTrigger, TResult> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      defaultPriority: this.defaultPriority,
      defaultTimeout: this.defaultTimeout,
      triggerSchema: this.triggerSchema,
      resultSchema: this.resultSchema,
      steps: this.steps,
      entryStepId: this.entryStepId,
      transitions: this.transitions,
      defaultLLMConfig: this.defaultLLMConfig,
      onStart: this.onStart?.bind(this),
      onComplete: this.onComplete?.bind(this),
      onFailed: this.onFailed?.bind(this),
      onStepComplete: this.onStepComplete?.bind(this),
    };
  }
}

/**
 * Builder for creating workflows fluently
 */
export class WorkflowBuilder<TTrigger = unknown, TResult = unknown> {
  private _id: string;
  private _name: string;
  private _description?: string;
  private _version?: string;
  private _defaultPriority?: WorkflowPriority;
  private _defaultTimeout?: number;
  private _triggerSchema?: z.ZodSchema<TTrigger>;
  private _resultSchema?: z.ZodSchema<TResult>;
  private _steps: Map<string, StepConfig> = new Map();
  private _transitions: StepTransition[] = [];
  private _entryStepId?: string;
  private _defaultLLMConfig?: Partial<LLMConfig>;
  private _onStart?: (instance: WorkflowInstance) => Promise<void>;
  private _onComplete?: (instance: WorkflowInstance, result: TResult) => Promise<void>;
  private _onFailed?: (instance: WorkflowInstance, error: string) => Promise<void>;
  private _onStepComplete?: (instance: WorkflowInstance, step: { id: string; name: string; output: unknown }) => Promise<void>;

  constructor(id: string, name: string) {
    this._id = id;
    this._name = name;
  }

  /**
   * Set workflow description
   */
  description(desc: string): this {
    this._description = desc;
    return this;
  }

  /**
   * Set workflow version
   */
  version(ver: string): this {
    this._version = ver;
    return this;
  }

  /**
   * Set default priority
   */
  priority(priority: WorkflowPriority): this {
    this._defaultPriority = priority;
    return this;
  }

  /**
   * Set default timeout
   */
  timeout(ms: number): this {
    this._defaultTimeout = ms;
    return this;
  }

  /**
   * Set trigger schema
   */
  trigger<T>(schema: z.ZodSchema<T>): WorkflowBuilder<T, TResult> {
    (this as unknown as WorkflowBuilder<T, TResult>)._triggerSchema = schema;
    return this as unknown as WorkflowBuilder<T, TResult>;
  }

  /**
   * Set result schema
   */
  result<T>(schema: z.ZodSchema<T>): WorkflowBuilder<TTrigger, T> {
    (this as unknown as WorkflowBuilder<TTrigger, T>)._resultSchema = schema;
    return this as unknown as WorkflowBuilder<TTrigger, T>;
  }

  /**
   * Set default LLM configuration
   */
  llmConfig(config: Partial<LLMConfig>): this {
    this._defaultLLMConfig = config;
    return this;
  }

  /**
   * Add a step
   */
  step(config: StepConfig): this {
    this._steps.set(config.id, config);
    return this;
  }

  /**
   * Add multiple steps
   */
  steps(...configs: StepConfig[]): this {
    for (const config of configs) {
      this._steps.set(config.id, config);
    }
    return this;
  }

  /**
   * Set the entry step
   */
  entryStep(stepId: string): this {
    this._entryStepId = stepId;
    return this;
  }

  /**
   * Add a transition
   */
  transition(from: string, to: string | string[], condition?: StepCondition): this {
    this._transitions.push({ from, to, condition });
    return this;
  }

  /**
   * Set onStart hook
   */
  onStart(handler: (instance: WorkflowInstance) => Promise<void>): this {
    this._onStart = handler;
    return this;
  }

  /**
   * Set onComplete hook
   */
  onComplete(
    handler: (instance: WorkflowInstance, result: TResult) => Promise<void>
  ): this {
    this._onComplete = handler;
    return this;
  }

  /**
   * Set onFailed hook
   */
  onFailed(
    handler: (instance: WorkflowInstance, error: string) => Promise<void>
  ): this {
    this._onFailed = handler;
    return this;
  }

  /**
   * Set onStepComplete hook
   */
  onStepComplete(
    handler: (
      instance: WorkflowInstance,
      step: { id: string; name: string; output: unknown }
    ) => Promise<void>
  ): this {
    this._onStepComplete = handler;
    return this;
  }

  /**
   * Build the workflow definition
   */
  build(): WorkflowDefinition<TTrigger, TResult> {
    if (!this._entryStepId && this._steps.size > 0) {
      // Default to first step if not specified
      this._entryStepId = this._steps.keys().next().value;
    }

    if (!this._entryStepId) {
      throw new Error("Workflow must have at least one step");
    }

    return {
      id: this._id,
      name: this._name,
      description: this._description,
      version: this._version,
      defaultPriority: this._defaultPriority,
      defaultTimeout: this._defaultTimeout,
      triggerSchema: this._triggerSchema,
      resultSchema: this._resultSchema,
      steps: this._steps,
      entryStepId: this._entryStepId,
      transitions: this._transitions,
      defaultLLMConfig: this._defaultLLMConfig,
      onStart: this._onStart,
      onComplete: this._onComplete,
      onFailed: this._onFailed,
      onStepComplete: this._onStepComplete,
    };
  }
}

/**
 * Create a new workflow builder
 */
export function workflow(id: string, name: string): WorkflowBuilder {
  return new WorkflowBuilder(id, name);
}

/**
 * Define a workflow from a plain object
 */
export function defineWorkflow<TTrigger = unknown, TResult = unknown>(
  definition: WorkflowDefinition<TTrigger, TResult>
): WorkflowDefinition<TTrigger, TResult> {
  // Ensure steps is a Map
  if (!(definition.steps instanceof Map)) {
    definition.steps = new Map(Object.entries(definition.steps));
  }

  return definition;
}

/**
 * Evaluate a condition expression
 */
function evaluateExpression(
  expression: string,
  context: WorkflowContext
): boolean {
  const fn = new Function(
    "context",
    `
    const { trigger, variables, stepOutputs, metadata } = context;
    return Boolean(${expression});
  `
  );
  return fn(context);
}

// =============================================================================
// Workflow Templates
// =============================================================================

/**
 * Common workflow patterns as templates
 */
export const WorkflowTemplates = {
  /**
   * Linear workflow - steps execute in sequence
   */
  linear<TTrigger = unknown, TResult = unknown>(
    id: string,
    name: string,
    steps: StepConfig[]
  ): WorkflowDefinition<TTrigger, TResult> {
    const stepsMap = new Map<string, StepConfig>();
    const transitions: StepTransition[] = [];

    for (let i = 0; i < steps.length; i++) {
      stepsMap.set(steps[i].id, steps[i]);
      if (i < steps.length - 1) {
        transitions.push({
          from: steps[i].id,
          to: steps[i + 1].id,
        });
      }
    }

    return {
      id,
      name,
      steps: stepsMap,
      entryStepId: steps[0]?.id ?? "",
      transitions,
    };
  },

  /**
   * Fan-out workflow - one step fans out to multiple parallel steps
   */
  fanOut<TTrigger = unknown, TResult = unknown>(
    id: string,
    name: string,
    entryStep: StepConfig,
    parallelSteps: StepConfig[],
    collectStep?: StepConfig
  ): WorkflowDefinition<TTrigger, TResult> {
    const stepsMap = new Map<string, StepConfig>();
    const transitions: StepTransition[] = [];

    // Add entry step
    stepsMap.set(entryStep.id, entryStep);

    // Add parallel steps
    for (const step of parallelSteps) {
      stepsMap.set(step.id, step);
    }

    // Transition from entry to all parallel steps
    transitions.push({
      from: entryStep.id,
      to: parallelSteps.map((s) => s.id),
    });

    // Add collect step if provided
    if (collectStep) {
      stepsMap.set(collectStep.id, collectStep);
      for (const step of parallelSteps) {
        transitions.push({
          from: step.id,
          to: collectStep.id,
        });
      }
    }

    return {
      id,
      name,
      steps: stepsMap,
      entryStepId: entryStep.id,
      transitions,
    };
  },

  /**
   * Decision tree - uses decision steps for branching
   */
  decisionTree<TTrigger = unknown, TResult = unknown>(
    id: string,
    name: string,
    entryStep: StepConfig,
    branches: Map<string, StepConfig[]>
  ): WorkflowDefinition<TTrigger, TResult> {
    const stepsMap = new Map<string, StepConfig>();
    const transitions: StepTransition[] = [];

    // Add entry step
    stepsMap.set(entryStep.id, entryStep);

    // Add branches
    for (const [branchId, steps] of branches) {
      for (let i = 0; i < steps.length; i++) {
        stepsMap.set(steps[i].id, steps[i]);
        if (i < steps.length - 1) {
          transitions.push({
            from: steps[i].id,
            to: steps[i + 1].id,
          });
        }
      }

      // Entry to first step of branch
      if (steps.length > 0) {
        // The entry step (decision step) will handle routing
        // No explicit transition needed
      }
    }

    return {
      id,
      name,
      steps: stepsMap,
      entryStepId: entryStep.id,
      transitions,
    };
  },
};
