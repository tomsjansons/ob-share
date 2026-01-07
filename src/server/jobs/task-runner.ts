/**
 * Task Runner
 *
 * Executes job phases sequentially, ensuring each phase is idempotent
 * and can be retried independently. Handles phase-level error recovery
 * and result propagation between phases.
 */

import { db } from "../db";
import { jobPhases } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { logger as baseLogger } from "@/lib/logger";
import type {
  JobDefinition,
  JobRecord,
  PhaseRecord,
  PhaseContext,
  PhaseResult,
} from "./types";

// Module logger for task runner
const logger = baseLogger.child({ module: "task-runner" });

/**
 * Yield to the event loop to allow HTTP requests to be processed.
 * This is necessary because better-sqlite3 is synchronous and blocks the event loop.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
  constructor(
    private jobDefinitions: Map<string, JobDefinition>,
    private handlerId: string
  ) {}

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

    const completedPhases: string[] = [];
    let previousOutput: unknown = null;
    let payload: unknown;

    try {
      payload = JSON.parse(job.payload);
    } catch {
      return {
        success: false,
        error: "Failed to parse job payload",
        completedPhases: [],
      };
    }

    for (let i = 0; i < phases.length; i++) {
      // Yield to event loop between processing each phase
      await yieldToEventLoop();

      const phaseRecord = phases[i];
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
        phaseInput
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
    input: unknown
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
      signal: new AbortController().signal, // Will be updated with actual signal
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
    .from(require("../db/schema").jobs)
    .where(eq(require("../db/schema").jobs.id, jobId))
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
