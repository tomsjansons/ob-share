/**
 * Task Runner
 *
 * Executes job phases sequentially, ensuring each phase is idempotent
 * and can be retried independently. Handles phase-level error recovery
 * and result propagation between phases.
 *
 * Key features for deployment resilience:
 * - Visibility heartbeat: Periodically extends job visibility during long-running phases
 * - Stalled phase handling: Resets 'running' phases to 'pending' on job reclaim
 * - Max execution time: Enforces maximum job execution time to prevent stuck jobs
 */

import { db } from "../db";
import { jobs, jobPhases } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { logger as baseLogger } from "@/lib/logger";
import { yieldToEventLoop } from "@/lib/async-utils";
import type {
  JobDefinition,
  JobRecord,
  PhaseRecord,
  PhaseContext,
  PhaseResult,
  QueueHandlerConfig,
} from "./types";
import { DEFAULT_QUEUE_CONFIG } from "./types";

// Module logger for task runner
const logger = baseLogger.child({ module: "task-runner" });

/**
 * Callback to extend job visibility timeout
 */
export type VisibilityExtender = (jobId: string) => Promise<boolean>;

interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  completedPhases: string[];
  failedPhase?: string;
}

/**
 * Task Runner executes job phases in order, handling retries and error recovery.
 */
export class TaskRunner {
  private config: Required<QueueHandlerConfig>;
  private visibilityHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentJobId: string | null = null;

  constructor(
    private jobDefinitions: Map<string, JobDefinition>,
    private handlerId: string,
    private visibilityExtender?: VisibilityExtender,
    config?: Partial<QueueHandlerConfig>
  ) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * Start visibility heartbeat for a job - extends visibility periodically to prevent
   * the job from being marked as stalled during long-running phases.
   */
  private startVisibilityHeartbeat(jobId: string): void {
    if (!this.visibilityExtender) {
      return;
    }

    this.currentJobId = jobId;
    this.visibilityHeartbeatTimer = setInterval(async () => {
      if (!this.visibilityExtender || !this.currentJobId) {
        return;
      }

      try {
        const extended = await this.visibilityExtender(this.currentJobId);
        if (extended) {
          logger.debug({
            event: "job.visibility.extended",
            jobId: this.currentJobId,
            handlerId: this.handlerId,
          }, "Extended job visibility during execution");
        } else {
          // Failed to extend - job may have been reclaimed by another handler
          logger.warn({
            event: "job.visibility.extend_failed",
            jobId: this.currentJobId,
            handlerId: this.handlerId,
          }, "Failed to extend job visibility - job may have been reclaimed");
        }
      } catch (err) {
        logger.error({
          event: "job.visibility.extend_error",
          jobId: this.currentJobId,
          handlerId: this.handlerId,
          err,
        }, "Error extending job visibility");
      }
    }, this.config.visibilityHeartbeatInterval);

    logger.debug({
      event: "job.visibility.heartbeat_started",
      jobId,
      intervalMs: this.config.visibilityHeartbeatInterval,
    }, "Started visibility heartbeat for job");
  }

  /**
   * Stop visibility heartbeat for a job
   */
  private stopVisibilityHeartbeat(): void {
    if (this.visibilityHeartbeatTimer) {
      clearInterval(this.visibilityHeartbeatTimer);
      this.visibilityHeartbeatTimer = null;

      if (this.currentJobId) {
        logger.debug({
          event: "job.visibility.heartbeat_stopped",
          jobId: this.currentJobId,
        }, "Stopped visibility heartbeat for job");
      }
    }
    this.currentJobId = null;
  }

  /**
   * Reset stalled phases - phases that were left in 'running' state because the
   * previous handler crashed or was stopped. These phases need to be retried.
   */
  private async resetStalledPhases(phases: PhaseRecord[]): Promise<void> {
    const stalledPhases = phases.filter(p => p.status === "running");

    if (stalledPhases.length === 0) {
      return;
    }

    logger.info({
      event: "job.phases.reset_stalled",
      phaseIds: stalledPhases.map(p => p.id),
      phaseNames: stalledPhases.map(p => p.name),
    }, "Resetting stalled phases to pending");

    const now = new Date();
    for (const phase of stalledPhases) {
      await db
        .update(jobPhases)
        .set({
          status: "pending",
          startedAt: null,
          error: "Phase was interrupted by handler restart - retrying",
          updatedAt: now,
        })
        .where(eq(jobPhases.id, phase.id));
    }
  }

  /**
   * Check if job has exceeded maximum execution time
   * Uses startedAt (when job began executing) if available,
   * falls back to createdAt for jobs that haven't started yet.
   *
   * For jobs that sat in the queue during deployment, we check against
   * createdAt but with a separate "stale job" threshold (2x max execution time)
   * to allow jobs to be properly executed after a restart.
   */
  private isJobExpired(job: JobRecord): boolean {
    if (this.config.maxJobExecutionTime === 0) {
      return false; // No limit
    }

    const now = Date.now();

    // If job has started, check execution time from start
    if (job.startedAt) {
      const executionTime = now - job.startedAt.getTime();
      return executionTime > this.config.maxJobExecutionTime;
    }

    // For jobs that haven't started yet, check if they're too old to even attempt
    // Use 2x max execution time as the threshold for stale jobs
    const jobAge = now - job.createdAt.getTime();
    const staleThreshold = this.config.maxJobExecutionTime * 2;
    return jobAge > staleThreshold;
  }

  /**
   * Execute all phases of a job
   */
  async executeJob(
    job: JobRecord,
    phases: PhaseRecord[],
    signal: AbortSignal
  ): Promise<ExecutionResult> {
    const definition = this.jobDefinitions.get(job.type);
    if (!definition) {
      return {
        success: false,
        error: `Unknown job type: ${job.type}`,
        completedPhases: [],
      };
    }

    // Check if job has exceeded maximum execution time
    if (this.isJobExpired(job)) {
      const now = Date.now();
      const executionTimeMs = job.startedAt
        ? now - job.startedAt.getTime()
        : null;
      const jobAgeMs = now - job.createdAt.getTime();

      logger.error({
        event: "job.expired",
        jobId: job.id,
        jobType: job.type,
        executionTimeMs,
        jobAgeMs,
        startedAt: job.startedAt?.toISOString(),
        maxExecutionTimeMs: this.config.maxJobExecutionTime,
      }, job.startedAt
        ? "Job exceeded maximum execution time"
        : "Job is too stale to execute (sat in queue too long)");

      return {
        success: false,
        error: job.startedAt
          ? `Job exceeded maximum execution time (${Math.round(this.config.maxJobExecutionTime / 1000)}s)`
          : `Job is too stale - was created ${Math.round(jobAgeMs / 1000)}s ago, max allowed is ${Math.round(this.config.maxJobExecutionTime * 2 / 1000)}s`,
        completedPhases: [],
      };
    }

    // Reset any phases that were left in 'running' state from a previous handler crash
    await this.resetStalledPhases(phases);

    // Reload phases after reset to get updated statuses
    const updatedPhases = await db
      .select()
      .from(jobPhases)
      .where(eq(jobPhases.jobId, job.id))
      .orderBy(asc(jobPhases.phaseOrder));

    // Start visibility heartbeat to prevent stalling during long-running phases
    this.startVisibilityHeartbeat(job.id);

    const completedPhases: string[] = [];
    let previousOutput: unknown = null;
    let payload: unknown;

    try {
      payload = JSON.parse(job.payload);
    } catch {
      this.stopVisibilityHeartbeat();
      return {
        success: false,
        error: "Failed to parse job payload",
        completedPhases: [],
      };
    }

    try {
      for (let i = 0; i < updatedPhases.length; i++) {
        // Yield to event loop between processing each phase
        await yieldToEventLoop();

        const phaseRecord = updatedPhases[i];
        const phaseDefinition = definition.phases[i];

        if (!phaseDefinition) {
          return {
            success: false,
            error: `Phase definition not found for phase ${phaseRecord.name}`,
            completedPhases,
            failedPhase: phaseRecord.name,
          };
        }

        // Check for cancellation
        if (signal.aborted) {
          return {
            success: false,
            error: "Job was cancelled",
            completedPhases,
          };
        }

        // Skip already completed phases (for job retries)
        if (phaseRecord.status === "completed") {
          completedPhases.push(phaseRecord.name);
          // Load the output from the completed phase
          if (phaseRecord.output) {
            try {
              previousOutput = JSON.parse(phaseRecord.output);
            } catch {
              // If we can't parse the output, continue with null
              previousOutput = null;
            }
          }
          continue;
        }

        // Skip already skipped phases
        if (phaseRecord.status === "skipped") {
          continue;
        }

        // Prepare phase input
        let phaseInput: unknown = previousOutput;
        if (phaseDefinition.transformInput) {
          try {
            phaseInput = phaseDefinition.transformInput(previousOutput, payload);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            await this.updatePhaseStatus(phaseRecord.id, "failed", undefined, error);
            return {
              success: false,
              error: `Failed to transform input for phase ${phaseRecord.name}: ${error}`,
              completedPhases,
              failedPhase: phaseRecord.name,
            };
          }
        }

        // Check if phase should run
        const context = this.createPhaseContext(
          job,
          phaseRecord,
          payload,
          phaseInput,
          signal
        );

        if (phaseDefinition.shouldRun && !phaseDefinition.shouldRun(context)) {
          await this.updatePhaseStatus(phaseRecord.id, "skipped");
          continue;
        }

        // Execute the phase
        const result = await this.executePhase(
          phaseRecord,
          phaseDefinition,
          context,
          signal
        );

        if (!result.success) {
          // Check if we should retry the phase
          if (result.shouldRetry && phaseRecord.retryCount < phaseRecord.maxRetries) {
            await this.incrementPhaseRetry(phaseRecord.id);
            return {
              success: false,
              error: result.error || `Phase ${phaseRecord.name} failed, will retry`,
              completedPhases,
              failedPhase: phaseRecord.name,
            };
          }

          await this.updatePhaseStatus(
            phaseRecord.id,
            "failed",
            undefined,
            result.error
          );

          return {
            success: false,
            error: result.error || `Phase ${phaseRecord.name} failed`,
            completedPhases,
            failedPhase: phaseRecord.name,
          };
        }

        // Phase succeeded
        await this.updatePhaseStatus(
          phaseRecord.id,
          "completed",
          result.output
        );

        completedPhases.push(phaseRecord.name);
        previousOutput = result.output;

        // Check if we should skip remaining phases
        if (result.skipRemaining) {
          break;
        }
      }

      return {
        success: true,
        output: previousOutput,
        completedPhases,
      };
    } finally {
      // Always stop visibility heartbeat when execution completes
      this.stopVisibilityHeartbeat();
    }
  }

  /**
   * Execute a single phase with error handling
   */
  private async executePhase(
    phaseRecord: PhaseRecord,
    phaseDefinition: {
      name: string;
      execute: (ctx: PhaseContext) => Promise<PhaseResult>;
    },
    context: PhaseContext,
    signal: AbortSignal
  ): Promise<PhaseResult> {
    // Mark phase as running
    await this.updatePhaseStatus(phaseRecord.id, "running");

    logger.debug({
      event: "phase.started",
      jobId: context.job.id,
      jobType: context.job.type,
      phaseId: phaseRecord.id,
      phaseName: phaseRecord.name,
      phaseOrder: phaseRecord.phaseOrder,
      retryCount: phaseRecord.retryCount,
    }, "Phase started");

    try {
      // Execute the phase
      const result = await phaseDefinition.execute(context);

      if (result.success) {
        logger.debug({
          event: "phase.completed",
          jobId: context.job.id,
          phaseId: phaseRecord.id,
          phaseName: phaseRecord.name,
        }, "Phase completed successfully");
      } else {
        logger.warn({
          event: "phase.failed",
          jobId: context.job.id,
          phaseId: phaseRecord.id,
          phaseName: phaseRecord.name,
          error: result.error,
          shouldRetry: result.shouldRetry,
        }, "Phase failed");
      }

      return result;
    } catch (err) {
      // Check if cancellation
      if (signal.aborted) {
        logger.info({
          event: "phase.cancelled",
          jobId: context.job.id,
          phaseId: phaseRecord.id,
          phaseName: phaseRecord.name,
        }, "Phase cancelled");
        return {
          success: false,
          error: "Phase cancelled",
          shouldRetry: true,
        };
      }

      const error = err instanceof Error ? err.message : String(err);
      logger.error({
        event: "phase.error",
        jobId: context.job.id,
        phaseId: phaseRecord.id,
        phaseName: phaseRecord.name,
        err,
      }, "Phase threw unexpected error");
      return {
        success: false,
        error,
        shouldRetry: true, // Assume unexpected errors should be retried
      };
    }
  }

  /**
   * Create the context object for phase execution
   */
  private createPhaseContext(
    job: JobRecord,
    phase: PhaseRecord,
    payload: unknown,
    input: unknown,
    signal: AbortSignal
  ): PhaseContext {
    return {
      job: {
        id: job.id,
        type: job.type,
        payload,
        retryCount: job.retryCount,
      },
      phase: {
        id: phase.id,
        name: phase.name,
        phaseOrder: phase.phaseOrder,
        input,
        retryCount: phase.retryCount,
      },
      handlerId: this.handlerId,
      signal, // Pass the actual job signal for proper cancellation propagation
    };
  }

  /**
   * Update the status of a phase
   */
  private async updatePhaseStatus(
    phaseId: string,
    status: PhaseRecord["status"],
    output?: unknown,
    error?: string
  ): Promise<void> {
    const now = new Date();

    const updates: Partial<PhaseRecord> = {
      status,
      updatedAt: now,
    };

    if (status === "running") {
      updates.startedAt = now;
    }

    if (status === "completed" || status === "failed" || status === "skipped") {
      updates.completedAt = now;
    }

    if (output !== undefined) {
      updates.output = JSON.stringify(output);
    }

    if (error !== undefined) {
      updates.error = error;
    }

    await db
      .update(jobPhases)
      .set(updates as Record<string, unknown>)
      .where(eq(jobPhases.id, phaseId));
  }

  /**
   * Increment the retry count for a phase
   */
  private async incrementPhaseRetry(phaseId: string): Promise<void> {
    const now = new Date();

    // First get current retry count
    const [current] = await db
      .select({ retryCount: jobPhases.retryCount })
      .from(jobPhases)
      .where(eq(jobPhases.id, phaseId))
      .limit(1);

    if (current) {
      await db
        .update(jobPhases)
        .set({
          retryCount: current.retryCount + 1,
          status: "pending",
          updatedAt: now,
        })
        .where(eq(jobPhases.id, phaseId));
    }
  }
}

/**
 * Utility to run a single phase independently (for testing or manual execution)
 */
export async function runPhaseManually(
  jobId: string,
  phaseName: string,
  jobDefinitions: Map<string, JobDefinition>,
  handlerId: string
): Promise<PhaseResult> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    return { success: false, error: "Job not found" };
  }

  const definition = jobDefinitions.get(job.type);
  if (!definition) {
    return { success: false, error: `Unknown job type: ${job.type}` };
  }

  const phaseDefinition = definition.phases.find((p) => p.name === phaseName);
  if (!phaseDefinition) {
    return { success: false, error: `Phase ${phaseName} not found` };
  }

  const [phase] = await db
    .select()
    .from(jobPhases)
    .where(and(eq(jobPhases.jobId, jobId), eq(jobPhases.name, phaseName)))
    .limit(1);

  if (!phase) {
    return { success: false, error: "Phase record not found" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(job.payload);
  } catch {
    return { success: false, error: "Failed to parse job payload" };
  }

  let input: unknown = null;
  if (phase.input) {
    try {
      input = JSON.parse(phase.input);
    } catch {
      // Continue with null input
    }
  }

  const context: PhaseContext = {
    job: {
      id: job.id,
      type: job.type,
      payload,
      retryCount: job.retryCount,
    },
    phase: {
      id: phase.id,
      name: phase.name,
      phaseOrder: phase.phaseOrder,
      input,
      retryCount: phase.retryCount,
    },
    handlerId,
    signal: new AbortController().signal,
  };

  try {
    return await phaseDefinition.execute(context);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
