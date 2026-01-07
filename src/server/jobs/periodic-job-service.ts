/**
 * Periodic Job Service
 *
 * Manages periodic job schedules - jobs that run at regular intervals.
 * This service is responsible for:
 * - Registering periodic job schedules
 * - Checking which schedules are due to run
 * - Creating job instances for due schedules
 * - Tracking schedule statistics
 */

import { db } from "../db";
import { periodicJobSchedules, jobs } from "../db/schema";
import { eq, lte, and, isNull, or } from "drizzle-orm";
import { createJob } from "./job-service";
import { JobRegistry } from "./registry";
import { logger as baseLogger } from "@/lib/logger";
import type { JobPriority } from "./types";

const logger = baseLogger.child({ module: "periodic-job-service" });

/**
 * Yield to the event loop to allow HTTP requests to be processed.
 * This is necessary because better-sqlite3 is synchronous and blocks the event loop.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Configuration for registering a periodic job schedule
 */
export interface PeriodicJobConfig {
  /** Unique identifier for this schedule */
  id: string;
  /** The job type to create */
  jobType: string;
  /** Interval between runs in milliseconds */
  intervalMs: number;
  /** Optional payload template (will be passed to each job) */
  payloadTemplate?: Record<string, unknown>;
  /** Whether the schedule is enabled (default: true) */
  enabled?: boolean;
  /** Job priority (optional) */
  priority?: JobPriority;
}

/**
 * Schedule record from database
 */
export interface PeriodicJobSchedule {
  id: string;
  jobType: string;
  enabled: boolean;
  intervalMs: number;
  payloadTemplate: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastJobId: string | null;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Register or update a periodic job schedule
 */
export async function registerPeriodicJob(config: PeriodicJobConfig): Promise<PeriodicJobSchedule> {
  const now = new Date();
  const nextRunAt = new Date(now.getTime() + config.intervalMs);

  // Check if schedule already exists
  const [existing] = await db
    .select()
    .from(periodicJobSchedules)
    .where(eq(periodicJobSchedules.id, config.id))
    .limit(1);

  if (existing) {
    // Update existing schedule
    const [updated] = await db
      .update(periodicJobSchedules)
      .set({
        jobType: config.jobType,
        intervalMs: config.intervalMs,
        payloadTemplate: config.payloadTemplate ? JSON.stringify(config.payloadTemplate) : null,
        enabled: config.enabled ?? true,
        updatedAt: now,
      })
      .where(eq(periodicJobSchedules.id, config.id))
      .returning();

    logger.info({
      event: "periodic.schedule.updated",
      scheduleId: config.id,
      jobType: config.jobType,
      intervalMs: config.intervalMs,
    }, "Periodic job schedule updated");

    return updated as PeriodicJobSchedule;
  }

  // Create new schedule
  const [created] = await db
    .insert(periodicJobSchedules)
    .values({
      id: config.id,
      jobType: config.jobType,
      intervalMs: config.intervalMs,
      payloadTemplate: config.payloadTemplate ? JSON.stringify(config.payloadTemplate) : null,
      enabled: config.enabled ?? true,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  logger.info({
    event: "periodic.schedule.created",
    scheduleId: config.id,
    jobType: config.jobType,
    intervalMs: config.intervalMs,
    nextRunAt: nextRunAt.toISOString(),
  }, "Periodic job schedule created");

  return created as PeriodicJobSchedule;
}

/**
 * Get all periodic job schedules
 */
export async function getAllPeriodicSchedules(): Promise<PeriodicJobSchedule[]> {
  const schedules = await db.select().from(periodicJobSchedules);
  return schedules as PeriodicJobSchedule[];
}

/**
 * Get a specific periodic job schedule
 */
export async function getPeriodicSchedule(id: string): Promise<PeriodicJobSchedule | null> {
  const [schedule] = await db
    .select()
    .from(periodicJobSchedules)
    .where(eq(periodicJobSchedules.id, id))
    .limit(1);

  return (schedule as PeriodicJobSchedule) || null;
}

/**
 * Enable or disable a periodic job schedule
 */
export async function setPeriodicScheduleEnabled(id: string, enabled: boolean): Promise<boolean> {
  const result = await db
    .update(periodicJobSchedules)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(eq(periodicJobSchedules.id, id))
    .returning({ id: periodicJobSchedules.id });

  return result.length > 0;
}

/**
 * Update the interval for a periodic job schedule
 */
export async function updatePeriodicScheduleInterval(id: string, intervalMs: number): Promise<boolean> {
  const result = await db
    .update(periodicJobSchedules)
    .set({
      intervalMs,
      updatedAt: new Date(),
    })
    .where(eq(periodicJobSchedules.id, id))
    .returning({ id: periodicJobSchedules.id });

  return result.length > 0;
}

/**
 * Get all schedules that are due to run
 */
export async function getDueSchedules(): Promise<PeriodicJobSchedule[]> {
  const now = new Date();

  const schedules = await db
    .select()
    .from(periodicJobSchedules)
    .where(
      and(
        eq(periodicJobSchedules.enabled, true),
        or(
          isNull(periodicJobSchedules.nextRunAt),
          lte(periodicJobSchedules.nextRunAt, now)
        )
      )
    );

  return schedules as PeriodicJobSchedule[];
}

/**
 * Process all due periodic job schedules
 * Creates new jobs for each schedule that is due
 */
export async function processDueSchedules(): Promise<{
  processed: number;
  created: string[];
  errors: Array<{ scheduleId: string; error: string }>;
}> {
  const dueSchedules = await getDueSchedules();

  logger.debug({
    event: "periodic.processing.start",
    dueCount: dueSchedules.length,
  }, "Processing due periodic schedules");

  const created: string[] = [];
  const errors: Array<{ scheduleId: string; error: string }> = [];

  for (const schedule of dueSchedules) {
    // Yield to event loop between processing each schedule
    await yieldToEventLoop();

    try {
      // Verify the job type exists
      const definition = JobRegistry.get(schedule.jobType);
      if (!definition) {
        logger.warn({
          event: "periodic.job_type.not_found",
          scheduleId: schedule.id,
          jobType: schedule.jobType,
        }, "Job type not found for periodic schedule");
        errors.push({
          scheduleId: schedule.id,
          error: `Job type not found: ${schedule.jobType}`,
        });
        continue;
      }

      // Parse payload template
      let payload: Record<string, unknown> = {};
      if (schedule.payloadTemplate) {
        try {
          payload = JSON.parse(schedule.payloadTemplate);
        } catch {
          logger.warn({
            event: "periodic.payload.parse_error",
            scheduleId: schedule.id,
          }, "Failed to parse payload template");
        }
      }

      // Add schedule metadata to payload
      payload._scheduleId = schedule.id;
      payload._scheduledAt = new Date().toISOString();

      // Create the job
      const job = await createJob({
        type: schedule.jobType,
        payload,
        priority: definition.defaultPriority,
      });

      // Update the schedule
      const now = new Date();
      const nextRunAt = new Date(now.getTime() + schedule.intervalMs);

      await db
        .update(periodicJobSchedules)
        .set({
          lastRunAt: now,
          nextRunAt,
          lastJobId: job.id,
          totalRuns: schedule.totalRuns + 1,
          updatedAt: now,
        })
        .where(eq(periodicJobSchedules.id, schedule.id));

      created.push(job.id);

      logger.debug({
        event: "periodic.job.created",
        scheduleId: schedule.id,
        jobId: job.id,
        jobType: schedule.jobType,
        nextRunAt: nextRunAt.toISOString(),
      }, "Created periodic job");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({
        event: "periodic.job.create_error",
        scheduleId: schedule.id,
        error,
      }, "Failed to create periodic job");
      errors.push({ scheduleId: schedule.id, error });
    }
  }

  logger.debug({
    event: "periodic.processing.complete",
    processed: dueSchedules.length,
    created: created.length,
    errors: errors.length,
  }, "Finished processing periodic schedules");

  return {
    processed: dueSchedules.length,
    created,
    errors,
  };
}

/**
 * Update schedule statistics when a job completes
 */
export async function updateScheduleStats(
  scheduleId: string,
  success: boolean
): Promise<void> {
  const [schedule] = await db
    .select()
    .from(periodicJobSchedules)
    .where(eq(periodicJobSchedules.id, scheduleId))
    .limit(1);

  if (!schedule) {
    return;
  }

  const updates: Partial<typeof schedule> = {
    updatedAt: new Date(),
  };

  if (success) {
    updates.successfulRuns = schedule.successfulRuns + 1;
  } else {
    updates.failedRuns = schedule.failedRuns + 1;
  }

  await db
    .update(periodicJobSchedules)
    .set(updates as Record<string, unknown>)
    .where(eq(periodicJobSchedules.id, scheduleId));
}

/**
 * Delete a periodic job schedule
 */
export async function deletePeriodicSchedule(id: string): Promise<boolean> {
  const result = await db
    .delete(periodicJobSchedules)
    .where(eq(periodicJobSchedules.id, id))
    .returning({ id: periodicJobSchedules.id });

  if (result.length > 0) {
    logger.info({
      event: "periodic.schedule.deleted",
      scheduleId: id,
    }, "Periodic job schedule deleted");
  }

  return result.length > 0;
}
