/**
 * Workflow Job - Integration with async job queue
 *
 * Provides a job definition that executes workflows through the
 * async job queue system for reliable, fault-tolerant execution.
 */

import { defineJob, JobPriority, createJob, type PhaseContext } from "@/server/jobs";
import { getOrchestrator } from "./orchestrator";
import { WorkflowRegistry } from "./registry";
import type {
  WorkflowInstance,
  WorkflowPriority,
  CreateWorkflowInstanceConfig,
} from "./types";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "workflow-job" });

/**
 * Payload for workflow execution jobs
 */
export interface WorkflowJobPayload {
  workflowId: string;
  trigger: unknown;
  instanceId?: string; // If resuming an existing instance
  variables?: Record<string, unknown>;
  userId?: string;
}

/**
 * Result of workflow execution
 */
export interface WorkflowJobResult {
  instanceId: string;
  workflowId: string;
  status: "completed" | "failed" | "cancelled";
  result?: unknown;
  error?: string;
  executionPath: string[];
  duration: number;
}

/**
 * Map workflow priority to job priority
 */
function mapPriority(workflowPriority?: WorkflowPriority): JobPriority {
  if (workflowPriority === undefined) {
    return JobPriority.NORMAL;
  }

  // WorkflowPriority and JobPriority have similar scales
  if (workflowPriority <= 0) return JobPriority.LOW;
  if (workflowPriority <= 10) return JobPriority.NORMAL;
  if (workflowPriority <= 20) return JobPriority.HIGH;
  return JobPriority.CRITICAL;
}

/**
 * Workflow execution job definition
 *
 * This job executes a workflow instance through the job queue,
 * providing reliability, retries, and monitoring.
 */
export const workflowExecutionJob = defineJob<WorkflowJobPayload>({
  type: "workflow-execution",
  description: "Executes an agentic workflow",
  defaultPriority: JobPriority.NORMAL,
  defaultMaxRetries: 3,

  phases: [
    // Phase 1: Validate workflow exists and create instance
    {
      name: "initialize",
      async execute(ctx: PhaseContext<WorkflowJobPayload>) {
        const { payload } = ctx.job;

        logger.debug(
          {
            event: "workflow.job.initialize",
            workflowId: payload.workflowId,
            jobId: ctx.job.id,
          },
          "Initializing workflow execution"
        );

        // Check if workflow exists
        const workflow = WorkflowRegistry.get(payload.workflowId);
        if (!workflow) {
          return {
            success: false,
            error: `Workflow not found: ${payload.workflowId}`,
            shouldRetry: false,
          };
        }

        // Validate trigger data
        if (workflow.triggerSchema) {
          const result = workflow.triggerSchema.safeParse(payload.trigger);
          if (!result.success) {
            return {
              success: false,
              error: `Invalid trigger data: ${result.error.message}`,
              shouldRetry: false,
            };
          }
        }

        // Create workflow instance
        const orchestrator = getOrchestrator();
        let instance: WorkflowInstance;

        if (payload.instanceId) {
          // Resume existing instance
          const existing = orchestrator.getInstance(payload.instanceId);
          if (!existing) {
            return {
              success: false,
              error: `Instance not found: ${payload.instanceId}`,
              shouldRetry: false,
            };
          }
          instance = existing;
        } else {
          // Create new instance
          instance = await orchestrator.createInstance({
            workflowId: payload.workflowId,
            trigger: payload.trigger,
            userId: payload.userId,
            variables: payload.variables,
          });
        }

        logger.info(
          {
            event: "workflow.job.initialized",
            workflowId: payload.workflowId,
            instanceId: instance.id,
            jobId: ctx.job.id,
          },
          "Workflow instance initialized"
        );

        return {
          success: true,
          output: {
            instanceId: instance.id,
            workflowId: payload.workflowId,
            startTime: Date.now(),
          },
        };
      },
    },

    // Phase 2: Execute workflow
    {
      name: "execute",
      async execute(ctx: PhaseContext<WorkflowJobPayload, { instanceId: string; workflowId: string; startTime: number }>) {
        const input = ctx.phase.input;
        if (!input) {
          return {
            success: false,
            error: "No input from initialize phase",
            shouldRetry: false,
          };
        }

        logger.debug(
          {
            event: "workflow.job.execute",
            instanceId: input.instanceId,
            workflowId: input.workflowId,
            jobId: ctx.job.id,
          },
          "Executing workflow"
        );

        const orchestrator = getOrchestrator();

        try {
          // Start the workflow execution
          await orchestrator.startInstance(input.instanceId);

          // Wait for completion
          const instance = await waitForCompletion(
            orchestrator,
            input.instanceId,
            ctx.signal
          );

          const duration = Date.now() - input.startTime;

          if (instance.status === "completed") {
            return {
              success: true,
              output: {
                instanceId: instance.id,
                workflowId: input.workflowId,
                status: "completed",
                result: instance.result,
                executionPath: instance.context.metadata.executionPath,
                duration,
              },
            };
          } else if (instance.status === "failed") {
            return {
              success: false,
              error: instance.error ?? "Workflow execution failed",
              shouldRetry: false, // Don't retry workflow failures
            };
          } else if (instance.status === "cancelled") {
            return {
              success: false,
              error: "Workflow was cancelled",
              shouldRetry: false,
            };
          } else {
            // Still running or in unexpected state
            return {
              success: false,
              error: `Unexpected workflow status: ${instance.status}`,
              shouldRetry: true,
            };
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          logger.error(
            {
              event: "workflow.job.execute.error",
              instanceId: input.instanceId,
              workflowId: input.workflowId,
              err,
            },
            "Workflow execution error"
          );

          return {
            success: false,
            error,
            shouldRetry: true,
          };
        }
      },
    },

    // Phase 3: Finalize and cleanup
    {
      name: "finalize",
      async execute(ctx: PhaseContext<WorkflowJobPayload, WorkflowJobResult>) {
        const input = ctx.phase.input;
        if (!input) {
          return {
            success: false,
            error: "No input from execute phase",
            shouldRetry: false,
          };
        }

        logger.info(
          {
            event: "workflow.job.finalize",
            instanceId: input.instanceId,
            workflowId: input.workflowId,
            status: input.status,
            duration: input.duration,
            jobId: ctx.job.id,
          },
          "Workflow job finalized"
        );

        // Any cleanup logic can go here

        return {
          success: true,
          output: input,
        };
      },
    },
  ],

  async onComplete(job, result) {
    const workflowResult = result as WorkflowJobResult;
    logger.info(
      {
        event: "workflow.job.completed",
        jobId: job.id,
        instanceId: workflowResult?.instanceId,
        workflowId: workflowResult?.workflowId,
        duration: workflowResult?.duration,
      },
      "Workflow job completed"
    );
  },

  async onFailed(job, error) {
    logger.error(
      {
        event: "workflow.job.failed",
        jobId: job.id,
        error,
      },
      "Workflow job failed"
    );
  },
});

/**
 * Wait for a workflow instance to complete
 */
async function waitForCompletion(
  orchestrator: ReturnType<typeof getOrchestrator>,
  instanceId: string,
  signal: AbortSignal,
  pollInterval = 100,
  timeout = 300000 // 5 minutes
): Promise<WorkflowInstance> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkStatus = () => {
      if (signal.aborted) {
        reject(new Error("Execution cancelled"));
        return;
      }

      const instance = orchestrator.getInstance(instanceId);
      if (!instance) {
        reject(new Error(`Instance not found: ${instanceId}`));
        return;
      }

      if (
        instance.status === "completed" ||
        instance.status === "failed" ||
        instance.status === "cancelled"
      ) {
        resolve(instance);
        return;
      }

      if (Date.now() - startTime > timeout) {
        orchestrator.cancelInstance(instanceId);
        reject(new Error("Workflow execution timed out"));
        return;
      }

      setTimeout(checkStatus, pollInterval);
    };

    checkStatus();
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a job to execute a workflow
 */
export async function createWorkflowJob(
  config: CreateWorkflowInstanceConfig & {
    priority?: WorkflowPriority;
  }
): Promise<string> {
  const workflow = WorkflowRegistry.get(config.workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${config.workflowId}`);
  }

  const jobRecord = await createJob<WorkflowJobPayload>({
    type: "workflow-execution",
    payload: {
      workflowId: config.workflowId,
      trigger: config.trigger,
      variables: config.variables,
      userId: config.userId,
    },
    priority: mapPriority(config.priority ?? workflow.defaultPriority),
    userId: config.userId,
  });

  logger.info(
    {
      event: "workflow.job.created",
      jobId: jobRecord.id,
      workflowId: config.workflowId,
    },
    "Workflow job created"
  );

  return jobRecord.id;
}

/**
 * Execute a workflow directly (synchronously, not via job queue)
 */
export async function executeWorkflow<TTrigger = unknown, TResult = unknown>(
  workflowId: string,
  trigger: TTrigger,
  options?: {
    userId?: string;
    variables?: Record<string, unknown>;
    timeout?: number;
  }
): Promise<TResult> {
  const orchestrator = getOrchestrator();
  return orchestrator.run<TTrigger, TResult>(workflowId, trigger, options);
}

/**
 * Schedule a workflow for later execution
 */
export async function scheduleWorkflow(
  config: CreateWorkflowInstanceConfig & {
    scheduledFor: Date;
    priority?: WorkflowPriority;
  }
): Promise<string> {
  const workflow = WorkflowRegistry.get(config.workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${config.workflowId}`);
  }

  const jobRecord = await createJob<WorkflowJobPayload>({
    type: "workflow-execution",
    payload: {
      workflowId: config.workflowId,
      trigger: config.trigger,
      variables: config.variables,
      userId: config.userId,
    },
    priority: mapPriority(config.priority ?? workflow.defaultPriority),
    userId: config.userId,
    scheduledFor: config.scheduledFor,
  });

  logger.info(
    {
      event: "workflow.job.scheduled",
      jobId: jobRecord.id,
      workflowId: config.workflowId,
      scheduledFor: config.scheduledFor,
    },
    "Workflow job scheduled"
  );

  return jobRecord.id;
}
