/**
 * Example Job Implementation
 *
 * Demonstrates how to create a job with multiple idempotent phases.
 * This can be used as a template for creating new job types.
 */

import { defineJob, JobPriority } from "../index";
import { logger as baseLogger } from "@/lib/logger";
import type { PhaseDefinition } from "../types";

// Module logger for example job
const logger = baseLogger.child({ module: "example-job" });

/**
 * Example payload type
 */
interface ExamplePayload {
  message: string;
  count: number;
}

/**
 * Example job that demonstrates the phase-based execution model.
 * Uses the functional defineJob approach for simplicity.
 */
export const exampleJob = defineJob<ExamplePayload>({
  type: "example-job",
  description: "An example job that demonstrates the job queue system",
  defaultPriority: JobPriority.NORMAL,
  defaultMaxRetries: 3,

  phases: [
    // Phase 1: Validate the input
    {
      name: "validate",
      async execute(ctx) {
        logger.debug({ event: "example.validate", jobId: ctx.job.id }, "Validating input");

        // Simulate validation
        if (!ctx.job.payload.message) {
          return {
            success: false,
            error: "Message is required",
          };
        }

        return {
          success: true,
          output: { validated: true },
        };
      },
    } as PhaseDefinition<ExamplePayload>,

    // Phase 2: Process the data
    {
      name: "process",
      async execute(ctx) {
        logger.debug({ event: "example.process", jobId: ctx.job.id }, "Processing");

        // Simulate processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = `Processed: ${ctx.job.payload.message}`;

        return {
          success: true,
          output: { processed: true, result },
        };
      },
      // Only run if validation passed
      shouldRun(ctx) {
        const input = ctx.phase.input as { validated?: boolean } | null;
        return input?.validated === true;
      },
    } as PhaseDefinition<ExamplePayload>,

    // Phase 3: Finalize
    {
      name: "finalize",
      async execute(ctx) {
        const input = ctx.phase.input as { result?: string } | null;
        logger.debug({ event: "example.finalize", jobId: ctx.job.id }, "Finalizing");

        // Simulate finalization
        await new Promise((resolve) => setTimeout(resolve, 50));

        return {
          success: true,
          output: { completed: true },
        };
      },
    } as PhaseDefinition<ExamplePayload>,
  ],

  // Validate the payload structure
  validatePayload(payload: unknown): payload is ExamplePayload {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as ExamplePayload).message === "string" &&
      "count" in payload &&
      typeof (payload as ExamplePayload).count === "number"
    );
  },

  // Called when the job completes successfully
  async onComplete(job) {
    logger.info({ event: "example.completed", jobId: job.id }, "Example job completed");
  },

  // Called when the job fails after all retries
  async onFailed(job, error) {
    logger.error({ event: "example.failed", jobId: job.id, error }, "Example job failed");
  },
});
