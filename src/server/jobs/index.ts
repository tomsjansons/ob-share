/**
 * Job Queue System
 *
 * A robust async job queue with:
 * - Idempotent phase-based execution
 * - Visibility timeouts for reliable processing
 * - Heartbeat monitoring for handler health
 * - Automatic retry with exponential backoff
 * - Manual trigger support
 *
 * Usage:
 * ```typescript
 * import { createJob, QueueHandler, JobRegistry } from "@/server/jobs";
 *
 * // Register job definitions
 * JobRegistry.register(new MyCustomJob());
 *
 * // Create a job
 * const job = await createJob({
 *   type: "my-custom-job",
 *   payload: { ... },
 * });
 *
 * // Start the queue handler
 * const handler = new QueueHandler(JobRegistry.getAll());
 * await handler.start();
 * ```
 */

// Types
export type {
  JobStatus,
  PhaseStatus,
  CreateJobConfig,
  JobRecord,
  PhaseRecord,
  PhaseContext,
  PhaseResult,
  PhaseDefinition,
  JobDefinition,
  QueueHandlerConfig,
  QueueStats,
  QueueEvent,
  QueueEventHandler,
} from "./types";

export { JobPriority, DEFAULT_QUEUE_CONFIG } from "./types";

// Base job classes
export { BaseJob, defineJob, createPhase } from "./base-job";

// Queue handler
export {
  QueueHandler,
  getAliveHandlers,
  cleanupDeadHandlers,
} from "./queue-handler";

// Task runner
export { TaskRunner, runPhaseManually } from "./task-runner";

// Job service
export {
  createJob,
  getJob,
  getJobPhases,
  getJobWithPhases,
  listJobs,
  getQueueStats,
  cancelJob,
  retryJob,
  cleanupOldJobs,
  cleanupStaleJobsOnStartup,
  getPendingJobCount,
  getHandlerHealth,
} from "./job-service";

// Job registry
export { JobRegistry } from "./registry";

// Queue scheduler
export { QueueScheduler, getGlobalScheduler } from "./scheduler";

// Periodic job service
export {
  registerPeriodicJob,
  getAllPeriodicSchedules,
  getPeriodicSchedule,
  setPeriodicScheduleEnabled,
  updatePeriodicScheduleInterval,
  getDueSchedules,
  processDueSchedules,
  updateScheduleStats,
  deletePeriodicSchedule,
  type PeriodicJobConfig,
  type PeriodicJobSchedule,
} from "./periodic-job-service";
