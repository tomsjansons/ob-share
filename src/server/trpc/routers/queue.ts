/**
 * Queue Router
 *
 * tRPC endpoints for managing the job queue:
 * - Trigger queue processing manually
 * - View queue status and statistics
 * - List and manage jobs
 * - Monitor handler health
 */

import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import {
  createJob,
  getJob,
  getJobWithPhases,
  listJobs,
  getQueueStats,
  cancelJob,
  retryJob,
  getHandlerHealth,
  JobPriority,
  JobRegistry,
} from "../../jobs";
import { getGlobalScheduler } from "../../jobs/scheduler";

/**
 * Job status enum for input validation
 */
const jobStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "stalled",
]);

export const queueRouter = router({
  /**
   * Get queue statistics
   */
  getStats: publicProcedure.query(async () => {
    const stats = await getQueueStats();
    return stats;
  }),

  /**
   * Get handler health information
   */
  getHealth: publicProcedure.query(async () => {
    const scheduler = getGlobalScheduler();
    return scheduler.getHealth();
  }),

  /**
   * Get scheduler status
   */
  getSchedulerStatus: publicProcedure.query(async () => {
    const scheduler = getGlobalScheduler();
    return scheduler.getStatus();
  }),

  /**
   * Trigger queue processing manually (protected)
   */
  triggerProcessing: protectedProcedure.mutation(async () => {
    const scheduler = getGlobalScheduler();
    const result = await scheduler.triggerProcessing();
    return result;
  }),

  /**
   * List jobs with filters
   */
  listJobs: protectedProcedure
    .input(
      z.object({
        status: z.union([jobStatusSchema, z.array(jobStatusSchema)]).optional(),
        type: z.string().optional(),
        userId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        orderBy: z.enum(["createdAt", "updatedAt", "priority"]).default("createdAt"),
        order: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ input }) => {
      const result = await listJobs(input);
      return result;
    }),

  /**
   * Get a job by ID with its phases
   */
  getJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const result = await getJobWithPhases(input.jobId);
      return result;
    }),

  /**
   * Create a new job
   */
  createJob: protectedProcedure
    .input(
      z.object({
        type: z.string(),
        payload: z.record(z.unknown()),
        priority: z.nativeEnum(JobPriority).optional(),
        maxRetries: z.number().min(0).max(10).optional(),
        scheduledFor: z.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify job type is registered
      if (!JobRegistry.has(input.type)) {
        throw new Error(`Unknown job type: ${input.type}`);
      }

      const job = await createJob(
        {
          type: input.type,
          payload: input.payload,
          priority: input.priority,
          maxRetries: input.maxRetries,
          scheduledFor: input.scheduledFor,
          userId: ctx.session.user.id,
        },
        JobRegistry.getAll()
      );

      return job;
    }),

  /**
   * Cancel a pending job
   */
  cancelJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const success = await cancelJob(input.jobId);
      return { success };
    }),

  /**
   * Retry a failed job
   */
  retryJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const success = await retryJob(input.jobId);
      return { success };
    }),

  /**
   * Get registered job types
   */
  getJobTypes: publicProcedure.query(async () => {
    const types = JobRegistry.getTypes();
    const definitions = JobRegistry.getAll();

    return types.map((type) => {
      const def = definitions.get(type);
      return {
        type,
        description: def?.description,
        phases: def?.phases.map((p) => p.name) || [],
      };
    });
  }),
});
