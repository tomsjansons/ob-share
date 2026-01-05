/**
 * Workflow Orchestrator - Manages workflow execution
 *
 * Handles the execution of workflows, including step scheduling,
 * parallel execution, state management, and error handling.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowContext,
  WorkflowStatus,
  StepConfig,
  StepResult,
  StepExecutionRecord,
  StepStatus,
  OrchestratorConfig,
  WorkflowEvent,
  WorkflowEventHandler,
  CreateWorkflowInstanceConfig,
  LLMConfig,
} from "./types";
import { WorkflowPriority } from "./types";
import { createStep, type BaseStep, type StepExecutionContext } from "./steps";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "workflow-orchestrator" });

/**
 * Default orchestrator configuration
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: Required<OrchestratorConfig> = {
  defaultLLMConfig: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 120000,
  },
  maxConcurrentWorkflows: 10,
  maxConcurrentStepsPerWorkflow: 5,
  defaultStepTimeout: 300000, // 5 minutes
  defaultRetryConfig: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 30000,
  },
};

/**
 * In-memory storage for step execution records
 * In production, this would be backed by a database
 */
interface StepExecutionStore {
  records: Map<string, StepExecutionRecord>;
  byWorkflow: Map<string, string[]>;
}

/**
 * Workflow Orchestrator
 *
 * Manages the lifecycle and execution of workflow instances.
 */
export class WorkflowOrchestrator {
  private config: Required<OrchestratorConfig>;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private instances: Map<string, WorkflowInstance> = new Map();
  private stepExecutions: StepExecutionStore = {
    records: new Map(),
    byWorkflow: new Map(),
  };
  private eventHandlers: Set<WorkflowEventHandler> = new Set();
  private runningSteps: Map<string, Set<string>> = new Map(); // instanceId -> stepIds
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      ...config,
      defaultLLMConfig: {
        ...DEFAULT_ORCHESTRATOR_CONFIG.defaultLLMConfig,
        ...config?.defaultLLMConfig,
      },
      defaultRetryConfig: {
        ...DEFAULT_ORCHESTRATOR_CONFIG.defaultRetryConfig,
        ...config?.defaultRetryConfig,
      },
    };
  }

  // ===========================================================================
  // Workflow Registration
  // ===========================================================================

  /**
   * Register a workflow definition
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.id)) {
      logger.warn(
        { workflowId: workflow.id },
        "Overwriting existing workflow"
      );
    }
    this.workflows.set(workflow.id, workflow);
    logger.info(
      { workflowId: workflow.id, name: workflow.name },
      "Workflow registered"
    );
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all registered workflows
   */
  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Register an event handler
   */
  on(handler: WorkflowEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event
   */
  private emit(event: WorkflowEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            logger.error(
              { event: "orchestrator.event_handler.error", err },
              "Event handler error"
            );
          });
        }
      } catch (err) {
        logger.error(
          { event: "orchestrator.event_handler.error", err },
          "Event handler error"
        );
      }
    }
  }

  // ===========================================================================
  // Instance Management
  // ===========================================================================

  /**
   * Create a new workflow instance
   */
  async createInstance<TTrigger = unknown>(
    config: CreateWorkflowInstanceConfig<TTrigger>
  ): Promise<WorkflowInstance<TTrigger>> {
    const workflow = this.workflows.get(config.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${config.workflowId}`);
    }

    // Validate trigger if schema exists
    if (workflow.triggerSchema) {
      const result = workflow.triggerSchema.safeParse(config.trigger);
      if (!result.success) {
        throw new Error(`Invalid trigger data: ${result.error.message}`);
      }
    }

    const now = new Date();
    const instance: WorkflowInstance<TTrigger> = {
      id: uuidv4(),
      workflowId: config.workflowId,
      status: "pending",
      priority: config.priority ?? workflow.defaultPriority ?? WorkflowPriority.NORMAL,
      trigger: config.trigger,
      context: {
        trigger: config.trigger,
        variables: config.variables ?? {},
        stepOutputs: {},
        metadata: {
          workflowId: config.workflowId,
          instanceId: "", // Will be set below
          startedAt: now,
          previousSteps: [],
          executionPath: [],
        },
      },
      currentStepIds: [],
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      userId: config.userId,
    };

    // Set the instance ID in metadata
    instance.context.metadata.instanceId = instance.id;

    // Store the instance
    this.instances.set(instance.id, instance);
    this.stepExecutions.byWorkflow.set(instance.id, []);
    this.runningSteps.set(instance.id, new Set());

    logger.info(
      {
        event: "workflow.instance.created",
        instanceId: instance.id,
        workflowId: config.workflowId,
      },
      "Workflow instance created"
    );

    return instance;
  }

  /**
   * Get a workflow instance
   */
  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get step executions for an instance
   */
  getStepExecutions(instanceId: string): StepExecutionRecord[] {
    const stepIds = this.stepExecutions.byWorkflow.get(instanceId) ?? [];
    return stepIds
      .map((id) => this.stepExecutions.records.get(id))
      .filter((r): r is StepExecutionRecord => r !== undefined);
  }

  // ===========================================================================
  // Workflow Execution
  // ===========================================================================

  /**
   * Start executing a workflow instance
   */
  async startInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    if (instance.status !== "pending") {
      throw new Error(`Instance is not pending: ${instance.status}`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${instance.workflowId}`);
    }

    // Update status
    instance.status = "running";
    instance.startedAt = new Date();
    instance.updatedAt = new Date();

    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(instanceId, abortController);

    // Call onStart hook
    if (workflow.onStart) {
      try {
        await workflow.onStart(instance);
      } catch (err) {
        logger.error(
          { event: "workflow.onStart.error", instanceId, err },
          "onStart hook error"
        );
      }
    }

    this.emit({ type: "workflow:started", instance });

    logger.info(
      {
        event: "workflow.started",
        instanceId,
        workflowId: instance.workflowId,
      },
      "Workflow started"
    );

    // Start with entry step
    try {
      await this.executeStep(instance, workflow.entryStepId, abortController.signal);
    } catch (err) {
      await this.failInstance(instanceId, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    instance: WorkflowInstance,
    stepId: string,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${instance.workflowId}`);
    }

    // Get step configuration
    const stepsMap = workflow.steps instanceof Map
      ? workflow.steps
      : new Map(Object.entries(workflow.steps));

    const stepConfig = stepsMap.get(stepId);
    if (!stepConfig) {
      throw new Error(`Step not found: ${stepId}`);
    }

    // Create step instance
    const step = createStep(
      stepConfig,
      workflow.defaultLLMConfig ?? this.config.defaultLLMConfig
    );

    // Check if step should run
    if (!step.shouldRun(instance.context)) {
      logger.debug(
        {
          event: "step.skipped",
          instanceId: instance.id,
          stepId,
        },
        "Step skipped due to condition"
      );

      // Determine next steps from transitions
      await this.processNextSteps(instance, stepId, [], signal);
      return;
    }

    // Create step execution record
    const now = new Date();
    const stepRecord: StepExecutionRecord = {
      id: uuidv4(),
      workflowInstanceId: instance.id,
      stepId,
      stepName: stepConfig.name,
      stepType: stepConfig.type,
      status: "pending",
      input: JSON.stringify(instance.context.stepOutputs[stepId] ?? null),
      output: null,
      error: null,
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.stepExecutions.records.set(stepRecord.id, stepRecord);
    this.stepExecutions.byWorkflow.get(instance.id)?.push(stepRecord.id);

    // Mark step as running
    stepRecord.status = "running";
    stepRecord.startedAt = new Date();
    instance.currentStepIds.push(stepId);
    instance.context.metadata.currentStep = stepId;
    this.runningSteps.get(instance.id)?.add(stepId);

    this.emit({ type: "step:started", instance, step: stepRecord });

    logger.debug(
      {
        event: "step.started",
        instanceId: instance.id,
        stepId,
        stepType: stepConfig.type,
      },
      "Step started"
    );

    // Execute the step
    const executionContext: StepExecutionContext = {
      workflowContext: instance.context,
      stepRecord,
      signal,
      previousOutput: instance.context.stepOutputs[
        instance.context.metadata.previousSteps.slice(-1)[0]
      ],
    };

    try {
      const result = await step.executeWithRetry(executionContext);

      // Update step record
      stepRecord.completedAt = new Date();
      stepRecord.updatedAt = new Date();

      if (result.success) {
        stepRecord.status = "completed";
        stepRecord.output = JSON.stringify(result.output);

        // Store output in context
        instance.context.stepOutputs[stepId] = result.output;

        // Add variables if provided
        if (result.variables) {
          Object.assign(instance.context.variables, result.variables);
        }

        // Update execution path
        instance.context.metadata.previousSteps.push(stepId);
        instance.context.metadata.executionPath.push(stepId);

        // Remove from running
        this.runningSteps.get(instance.id)?.delete(stepId);
        instance.currentStepIds = instance.currentStepIds.filter((id) => id !== stepId);

        this.emit({ type: "step:completed", instance, step: stepRecord, output: result.output });

        // Call step complete hook
        if (workflow.onStepComplete) {
          try {
            await workflow.onStepComplete(instance, stepRecord);
          } catch (err) {
            logger.error(
              { event: "workflow.onStepComplete.error", instanceId: instance.id, err },
              "onStepComplete hook error"
            );
          }
        }

        logger.debug(
          {
            event: "step.completed",
            instanceId: instance.id,
            stepId,
          },
          "Step completed"
        );

        // Check if workflow should end early
        if (result.skipRemaining) {
          await this.completeInstance(instance.id, result.output);
          return;
        }

        // Process next steps
        await this.processNextSteps(instance, stepId, result.nextStepIds, signal);
      } else {
        stepRecord.status = "failed";
        stepRecord.error = result.error ?? "Unknown error";

        // Remove from running
        this.runningSteps.get(instance.id)?.delete(stepId);
        instance.currentStepIds = instance.currentStepIds.filter((id) => id !== stepId);

        this.emit({
          type: "step:failed",
          instance,
          step: stepRecord,
          error: stepRecord.error,
        });

        logger.error(
          {
            event: "step.failed",
            instanceId: instance.id,
            stepId,
            error: stepRecord.error,
          },
          "Step failed"
        );

        // Fail the workflow
        await this.failInstance(instance.id, stepRecord.error);
      }
    } catch (err) {
      stepRecord.status = "failed";
      stepRecord.error = err instanceof Error ? err.message : String(err);
      stepRecord.completedAt = new Date();
      stepRecord.updatedAt = new Date();

      this.runningSteps.get(instance.id)?.delete(stepId);
      instance.currentStepIds = instance.currentStepIds.filter((id) => id !== stepId);

      this.emit({
        type: "step:failed",
        instance,
        step: stepRecord,
        error: stepRecord.error,
      });

      logger.error(
        {
          event: "step.error",
          instanceId: instance.id,
          stepId,
          err,
        },
        "Step threw an error"
      );

      await this.failInstance(instance.id, stepRecord.error);
    }
  }

  /**
   * Process next steps after a step completes
   */
  private async processNextSteps(
    instance: WorkflowInstance,
    currentStepId: string,
    explicitNextStepIds: string[] | undefined,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      return;
    }

    // Get next step IDs
    let nextStepIds: string[] = [];

    if (explicitNextStepIds && explicitNextStepIds.length > 0) {
      // Use explicitly set next steps
      nextStepIds = explicitNextStepIds;
    } else if (workflow.transitions && workflow.transitions.length > 0) {
      // Check transitions
      const relevantTransitions = workflow.transitions.filter(
        (t) => t.from === currentStepId
      );

      for (const transition of relevantTransitions) {
        // Check condition
        if (transition.condition) {
          let conditionResult = false;
          if (transition.condition.evaluate) {
            conditionResult = transition.condition.evaluate(instance.context);
          } else if (transition.condition.expression) {
            try {
              conditionResult = this.evaluateExpression(
                transition.condition.expression,
                instance.context
              );
            } catch {
              conditionResult = false;
            }
          }
          if (!conditionResult) {
            continue;
          }
        }

        if (Array.isArray(transition.to)) {
          nextStepIds.push(...transition.to);
        } else {
          nextStepIds.push(transition.to);
        }
      }
    }

    // If no next steps and no running steps, workflow is complete
    if (nextStepIds.length === 0) {
      const runningSteps = this.runningSteps.get(instance.id);
      if (!runningSteps || runningSteps.size === 0) {
        // Get last output as result
        const lastStep = instance.context.metadata.executionPath.slice(-1)[0];
        const result = lastStep
          ? instance.context.stepOutputs[lastStep]
          : undefined;
        await this.completeInstance(instance.id, result);
      }
      return;
    }

    // Execute next steps (potentially in parallel)
    const stepPromises = nextStepIds.map((stepId) =>
      this.executeStep(instance, stepId, signal)
    );

    // Wait for all parallel steps
    await Promise.all(stepPromises);
  }

  /**
   * Complete a workflow instance
   */
  private async completeInstance(
    instanceId: string,
    result: unknown
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return;
    }

    const workflow = this.workflows.get(instance.workflowId);

    instance.status = "completed";
    instance.result = result;
    instance.completedAt = new Date();
    instance.updatedAt = new Date();
    instance.currentStepIds = [];

    // Clean up
    this.abortControllers.delete(instanceId);
    this.runningSteps.delete(instanceId);

    // Call onComplete hook
    if (workflow?.onComplete) {
      try {
        await workflow.onComplete(instance, result);
      } catch (err) {
        logger.error(
          { event: "workflow.onComplete.error", instanceId, err },
          "onComplete hook error"
        );
      }
    }

    this.emit({ type: "workflow:completed", instance, result });

    logger.info(
      {
        event: "workflow.completed",
        instanceId,
        workflowId: instance.workflowId,
      },
      "Workflow completed"
    );
  }

  /**
   * Fail a workflow instance
   */
  private async failInstance(
    instanceId: string,
    error: string
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return;
    }

    const workflow = this.workflows.get(instance.workflowId);

    instance.status = "failed";
    instance.error = error;
    instance.completedAt = new Date();
    instance.updatedAt = new Date();
    instance.currentStepIds = [];

    // Abort any running operations
    const abortController = this.abortControllers.get(instanceId);
    if (abortController) {
      abortController.abort();
    }

    // Clean up
    this.abortControllers.delete(instanceId);
    this.runningSteps.delete(instanceId);

    // Call onFailed hook
    if (workflow?.onFailed) {
      try {
        await workflow.onFailed(instance, error);
      } catch (err) {
        logger.error(
          { event: "workflow.onFailed.error", instanceId, err },
          "onFailed hook error"
        );
      }
    }

    this.emit({ type: "workflow:failed", instance, error });

    logger.error(
      {
        event: "workflow.failed",
        instanceId,
        workflowId: instance.workflowId,
        error,
      },
      "Workflow failed"
    );
  }

  /**
   * Cancel a workflow instance
   */
  async cancelInstance(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return false;
    }

    if (instance.status !== "running" && instance.status !== "paused") {
      return false;
    }

    // Abort operations
    const abortController = this.abortControllers.get(instanceId);
    if (abortController) {
      abortController.abort();
    }

    instance.status = "cancelled";
    instance.completedAt = new Date();
    instance.updatedAt = new Date();
    instance.currentStepIds = [];

    // Clean up
    this.abortControllers.delete(instanceId);
    this.runningSteps.delete(instanceId);

    logger.info(
      { event: "workflow.cancelled", instanceId },
      "Workflow cancelled"
    );

    return true;
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateExpression(
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

  // ===========================================================================
  // High-Level API
  // ===========================================================================

  /**
   * Run a workflow with trigger data and wait for completion
   */
  async run<TTrigger = unknown, TResult = unknown>(
    workflowId: string,
    trigger: TTrigger,
    options?: {
      userId?: string;
      variables?: Record<string, unknown>;
      timeout?: number;
    }
  ): Promise<TResult> {
    const instance = await this.createInstance({
      workflowId,
      trigger,
      userId: options?.userId,
      variables: options?.variables,
    });

    await this.startInstance(instance.id);

    // Wait for completion
    const timeout = options?.timeout ?? 300000; // 5 minutes default
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const current = this.instances.get(instance.id);
        if (!current) {
          reject(new Error("Instance not found"));
          return;
        }

        if (current.status === "completed") {
          resolve(current.result as TResult);
          return;
        }

        if (current.status === "failed") {
          reject(new Error(current.error ?? "Workflow failed"));
          return;
        }

        if (current.status === "cancelled") {
          reject(new Error("Workflow cancelled"));
          return;
        }

        if (Date.now() - startTime > timeout) {
          this.cancelInstance(instance.id);
          reject(new Error("Workflow timed out"));
          return;
        }

        // Check again
        setTimeout(checkStatus, 100);
      };

      checkStatus();
    });
  }
}

// ===========================================================================
// Global Orchestrator
// ===========================================================================

let globalOrchestrator: WorkflowOrchestrator | null = null;

/**
 * Get the global orchestrator instance
 */
export function getOrchestrator(
  config?: Partial<OrchestratorConfig>
): WorkflowOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new WorkflowOrchestrator(config);
  }
  return globalOrchestrator;
}

/**
 * Reset the global orchestrator (for testing)
 */
export function resetOrchestrator(): void {
  globalOrchestrator = null;
}
