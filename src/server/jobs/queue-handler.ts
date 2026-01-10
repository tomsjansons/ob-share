/**
 * Queue Handler
 *
 * Responsible for:
 * - Polling the job queue for pending jobs
 * - Managing visibility timeouts to prevent duplicate processing
 * - Sending heartbeats to indicate the handler is alive
 * - Coordinating job execution with the task runner
 * - Handling graceful shutdown
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { jobs, jobPhases, queueHandlerHeartbeat, queueLock } from "../db/schema";
import { eq, and, lte, or, sql, isNull, asc } from "drizzle-orm";
import { logger as baseLogger } from "@/lib/logger";
import { yieldToEventLoop, settleAll } from "@/lib/async-utils";
import type {
  QueueHandlerConfig,
  QueueStats,
  QueueEvent,
  QueueEventHandler,
  JobDefinition,
  JobRecord,
} from "./types";
import { DEFAULT_QUEUE_CONFIG } from "./types";
import { TaskRunner } from "./task-runner";

// Module logger for queue handler
const logger = baseLogger.child({ module: "queue-handler" });

/**
 * Queue Handler manages the lifecycle of background job processing.
 */
export class QueueHandler {
  private config: Required<QueueHandlerConfig>;
  private isRunning = false;
  private isStopping = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentJobs: Map<string, AbortController> = new Map();
  private runningJobPromises: Map<string, Promise<void>> = new Map(); // Track running job promises for graceful shutdown
  private eventHandlers: QueueEventHandler[] = [];
  private taskRunner: TaskRunner;

  private stats: {
    startedAt: Date | null;
    jobsProcessed: number;
    jobsFailed: number;
    lastHeartbeat: Date | null;
  } = {
    startedAt: null,
    jobsProcessed: 0,
    jobsFailed: 0,
    lastHeartbeat: null,
  };

  constructor(
    private jobDefinitions: Map<string, JobDefinition>,
    config?: QueueHandlerConfig
  ) {
    this.config = {
      ...DEFAULT_QUEUE_CONFIG,
      handlerId: config?.handlerId || `handler-${randomUUID().slice(0, 8)}`,
      ...config,
    };
    this.taskRunner = new TaskRunner(this.jobDefinitions, this.config.handlerId);
  }

  /**
   * Register an event handler to receive queue events
   */
  on(handler: QueueEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are called concurrently and errors are logged but don't interrupt processing.
   */
  private async emitAsync(event: QueueEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) => {
              logger.error({ event: "queue.event.error", err, eventType: event.type }, "Event handler error");
            })
          );
        }
      } catch (err) {
        logger.error({ event: "queue.event.error", err, eventType: event.type }, "Event handler error");
      }
    }

    // Wait for all handlers to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Emit an event synchronously (fire-and-forget).
   * Use emitAsync when you need to wait for handlers.
   */
  private emit(event: QueueEvent): void {
    // Fire-and-forget for non-critical events
    this.emitAsync(event).catch((err) => {
      logger.error({ event: "queue.emit.error", err }, "Error emitting event");
    });
  }

  /**
   * Start the queue handler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({ event: "queue.handler.already_running", handlerId: this.config.handlerId }, "Queue handler is already running");
      return;
    }

    this.isRunning = true;
    this.isStopping = false;
    this.stats.startedAt = new Date();
    this.stats.jobsProcessed = 0;
    this.stats.jobsFailed = 0;

    // Register this handler in the heartbeat table
    await this.registerHandler();

    // Start heartbeat
    this.startHeartbeat();

    // Emit start event
    this.emit({ type: "handler:started", handlerId: this.config.handlerId });

    logger.debug({ event: "queue.handler.started", handlerId: this.config.handlerId }, "Queue handler started");

    // Start polling
    await this.poll();
  }

  /**
   * Stop the queue handler gracefully.
   * Waits for running jobs to complete (up to shutdownTimeout).
   */
  async stop(): Promise<void> {
    if (!this.isRunning || this.isStopping) {
      return;
    }

    this.isStopping = true;
    const runningJobCount = this.runningJobPromises.size;
    logger.debug({ event: "queue.handler.stopping", handlerId: this.config.handlerId, runningJobs: runningJobCount }, "Queue handler stopping");

    // Stop polling - no new jobs will be picked up
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Signal all running jobs to abort (graceful cancellation)
    for (const [jobId, controller] of this.currentJobs) {
      logger.info({ event: "job.cancelling", jobId, handlerId: this.config.handlerId }, "Signalling job to stop");
      controller.abort();
    }

    // Wait for running jobs to complete, using tracked promises
    if (this.runningJobPromises.size > 0) {
      logger.debug({ event: "queue.handler.waiting_for_jobs", count: this.runningJobPromises.size }, "Waiting for running jobs to complete");

      // Create a timeout promise
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, this.config.shutdownTimeout);
      });

      // Wait for all jobs or timeout
      const allJobsPromise = Promise.allSettled(
        Array.from(this.runningJobPromises.values())
      );

      await Promise.race([allJobsPromise, timeoutPromise]);

      // Log if any jobs are still running after timeout
      if (this.runningJobPromises.size > 0) {
        logger.warn({
          event: "queue.handler.shutdown_timeout",
          remainingJobs: Array.from(this.runningJobPromises.keys()),
        }, "Shutdown timeout reached with jobs still running");
      }
    }

    // Mark handler as stopped
    await this.unregisterHandler();

    this.isRunning = false;
    this.isStopping = false;
    this.runningJobPromises.clear();

    await this.emitAsync({ type: "handler:stopped", handlerId: this.config.handlerId });
    logger.debug({ event: "queue.handler.stopped", handlerId: this.config.handlerId, jobsProcessed: this.stats.jobsProcessed, jobsFailed: this.stats.jobsFailed }, "Queue handler stopped");
  }

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats {
    return {
      handlerId: this.config.handlerId,
      status: this.isStopping ? "stopping" : this.isRunning ? "running" : "stopped",
      startedAt: this.stats.startedAt || new Date(),
      jobsProcessed: this.stats.jobsProcessed,
      jobsFailed: this.stats.jobsFailed,
      lastHeartbeat: this.stats.lastHeartbeat || new Date(),
      currentJobs: Array.from(this.currentJobs.keys()),
    };
  }

  /**
   * Manually trigger a single poll cycle
   */
  async triggerPoll(): Promise<number> {
    return this.processPendingJobs();
  }

  /**
   * Poll for pending jobs
   */
  private async poll(): Promise<void> {
    if (!this.isRunning || this.isStopping) {
      logger.debug({
        event: "queue.poll.skip",
        handlerId: this.config.handlerId,
        isRunning: this.isRunning,
        isStopping: this.isStopping,
      });
      return;
    }

    logger.debug({
      event: "queue.poll.start",
      handlerId: this.config.handlerId,
      currentJobs: this.currentJobs.size,
      concurrency: this.config.concurrency,
    });

    try {
      const processed = await this.processPendingJobs();
      logger.debug({
        event: "queue.poll.complete",
        handlerId: this.config.handlerId,
        jobsProcessed: processed,
        currentJobs: this.currentJobs.size,
      });
    } catch (err) {
      logger.error({ event: "queue.poll.error", err, handlerId: this.config.handlerId }, "Error during poll");
    }

    // Schedule next poll
    if (this.isRunning && !this.isStopping) {
      logger.debug({
        event: "queue.poll.scheduling_next",
        handlerId: this.config.handlerId,
        nextPollMs: this.config.pollInterval,
      });
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval);
    }
  }

  /**
   * Process all pending jobs
   */
  private async processPendingJobs(): Promise<number> {
    logger.debug({
      event: "queue.process.start",
      handlerId: this.config.handlerId,
    });

    // First, handle stalled jobs (visibility timeout expired)
    await this.handleStalledJobs();

    // Yield to event loop after database operation
    await yieldToEventLoop();

    // Get available slots
    const availableSlots = this.config.concurrency - this.currentJobs.size;
    if (availableSlots <= 0) {
      logger.debug({
        event: "queue.process.no_slots",
        handlerId: this.config.handlerId,
        currentJobs: this.currentJobs.size,
        concurrency: this.config.concurrency,
      });
      return 0;
    }

    const now = new Date();

    // Query for pending jobs that are:
    // 1. Status is 'pending' or 'stalled'
    // 2. scheduledFor <= now
    // 3. visibleAt <= now (not claimed by another handler)
    const pendingJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          or(eq(jobs.status, "pending"), eq(jobs.status, "stalled")),
          lte(jobs.scheduledFor, now),
          lte(jobs.visibleAt, now)
        )
      )
      .orderBy(asc(jobs.priority), asc(jobs.createdAt))
      .limit(availableSlots);

    // Only log at INFO level if there are jobs to process
    if (pendingJobs.length > 0) {
      logger.info({
        event: "queue.process.jobs_found",
        handlerId: this.config.handlerId,
        pendingJobsCount: pendingJobs.length,
        availableSlots,
        jobIds: pendingJobs.map(j => j.id),
        jobTypes: pendingJobs.map(j => j.type),
      });
    }

    let processedCount = 0;

    for (const job of pendingJobs) {
      // Yield to event loop between processing each job
      await yieldToEventLoop();

      logger.debug({
        event: "queue.process.claiming_job",
        handlerId: this.config.handlerId,
        jobId: job.id,
        jobType: job.type,
      });

      // Try to claim the job by updating visibility timeout
      // Pass the reference time used in the SELECT query to ensure consistent comparison
      const claimed = await this.claimJob(job.id, now);
      if (claimed) {
        processedCount++;
        logger.debug({
          event: "queue.process.job_claimed",
          handlerId: this.config.handlerId,
          jobId: job.id,
          jobType: job.type,
        });
        // Process job in background (don't await) but track the promise for graceful shutdown
        const jobPromise = this.processJob(job as JobRecord).catch((err) => {
          logger.error({ event: "job.process.error", jobId: job.id, jobType: job.type, err }, "Error processing job");
        }).finally(() => {
          // Remove from tracking when done
          this.runningJobPromises.delete(job.id);
        });
        this.runningJobPromises.set(job.id, jobPromise);
      } else {
        // Log at info level to help diagnose claim failures
        logger.info({
          event: "queue.process.job_claim_failed",
          handlerId: this.config.handlerId,
          jobId: job.id,
          jobType: job.type,
          referenceTime: now.toISOString(),
          reason: "Job was claimed by another handler or status changed",
        });
      }
    }

    logger.debug({
      event: "queue.process.complete",
      handlerId: this.config.handlerId,
      processedCount,
    });

    return processedCount;
  }

  /**
   * Claim a job for processing using optimistic locking.
   * Returns true if successfully claimed, false if another handler got it first.
   *
   * RACE CONDITION PROTECTION:
   * This uses an atomic UPDATE with a WHERE clause that checks the job is still
   * in the expected state (pending/stalled with visibleAt <= referenceTime).
   * If another handler already claimed the job (changed status to 'processing'
   * and updated visibleAt), this UPDATE will not match any rows.
   *
   * This is a standard optimistic locking pattern for distributed job queues
   * that prevents duplicate processing without requiring database-level locks.
   *
   * @param jobId - The job ID to claim
   * @param referenceTime - The reference time to use for visibility check (should match the SELECT query time)
   * @returns true if the job was successfully claimed, false if another handler claimed it first
   */
  private async claimJob(jobId: string, referenceTime?: Date): Promise<boolean> {
    const now = referenceTime || new Date();
    const claimTime = new Date();
    const visibleAt = new Date(claimTime.getTime() + this.config.visibilityTimeout);

    logger.debug({
      event: "queue.claim.attempt",
      handlerId: this.config.handlerId,
      jobId,
      referenceTime: now.toISOString(),
      referenceTimeMs: now.getTime(),
      claimTime: claimTime.toISOString(),
    });

    // Atomic update - only succeeds if job is still claimable
    const result = await db
      .update(jobs)
      .set({
        status: "processing",
        visibleAt,
        handlerId: this.config.handlerId,
        startedAt: claimTime,
        updatedAt: claimTime,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          or(eq(jobs.status, "pending"), eq(jobs.status, "stalled")),
          lte(jobs.visibleAt, now)
        )
      )
      .returning({ id: jobs.id });

    return result.length > 0;
  }

  /**
   * Process a single job
   */
  private async processJob(job: JobRecord): Promise<void> {
    const abortController = new AbortController();
    this.currentJobs.set(job.id, abortController);

    this.emit({ type: "job:started", job });

    try {
      // Get or create phases for this job
      let phases = await db
        .select()
        .from(jobPhases)
        .where(eq(jobPhases.jobId, job.id))
        .orderBy(asc(jobPhases.phaseOrder));

      // If no phases exist, create them from the job definition
      if (phases.length === 0) {
        const definition = this.jobDefinitions.get(job.type);
        if (!definition) {
          throw new Error(`Unknown job type: ${job.type}`);
        }

        const now = new Date();
        const phaseRecords = definition.phases.map((phase, index) => ({
          id: randomUUID(),
          jobId: job.id,
          name: phase.name,
          phaseOrder: index,
          status: "pending" as const,
          input: null,
          output: null,
          error: null,
          retryCount: 0,
          maxRetries: phase.maxRetries ?? 3,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }));

        await db.insert(jobPhases).values(phaseRecords);
        phases = phaseRecords;
      }

      // Execute phases using the task runner
      const result = await this.taskRunner.executeJob(
        job,
        phases,
        abortController.signal
      );

      if (result.success) {
        await this.completeJob(job, result.output);
      } else {
        await this.failJob(job, result.error || "Unknown error");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.failJob(job, errorMessage);
    } finally {
      this.currentJobs.delete(job.id);
    }
  }

  /**
   * Mark a job as completed
   */
  private async completeJob(job: JobRecord, result: unknown): Promise<void> {
    const now = new Date();

    await db
      .update(jobs)
      .set({
        status: "completed",
        result: JSON.stringify(result),
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));

    this.stats.jobsProcessed++;
    this.emit({ type: "job:completed", job, result });

    logger.debug({ event: "job.completed", jobId: job.id, jobType: job.type, handlerId: this.config.handlerId }, "Job completed");

    // Call onComplete hook
    const definition = this.jobDefinitions.get(job.type);
    if (definition?.onComplete) {
      try {
        await definition.onComplete(job, result);
      } catch (err) {
        logger.error({ event: "job.hook.error", jobId: job.id, hook: "onComplete", err }, "Error in onComplete hook");
      }
    }
  }

  /**
   * Mark a job as failed or schedule for retry
   */
  private async failJob(job: JobRecord, error: string): Promise<void> {
    const now = new Date();
    const newRetryCount = job.retryCount + 1;

    if (newRetryCount < job.maxRetries) {
      // Schedule retry with exponential backoff
      const backoffMs = Math.min(
        1000 * Math.pow(2, newRetryCount),
        60000 // Max 1 minute
      );
      const scheduledFor = new Date(now.getTime() + backoffMs);

      await db
        .update(jobs)
        .set({
          status: "pending",
          retryCount: newRetryCount,
          visibleAt: scheduledFor,
          scheduledFor,
          handlerId: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));

      logger.info({ event: "job.retrying", jobId: job.id, jobType: job.type, attempt: newRetryCount, maxRetries: job.maxRetries, backoffMs }, "Job scheduled for retry");
      this.emit({ type: "job:retrying", job, attempt: newRetryCount });
    } else {
      // Max retries reached, mark as failed
      await db
        .update(jobs)
        .set({
          status: "failed",
          result: JSON.stringify({ error }),
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));

      this.stats.jobsFailed++;
      this.emit({ type: "job:failed", job, error });

      logger.error({ event: "job.failed", jobId: job.id, jobType: job.type, error, retryCount: newRetryCount }, "Job failed after max retries");

      // Call onFailed hook
      const definition = this.jobDefinitions.get(job.type);
      if (definition?.onFailed) {
        try {
          await definition.onFailed(job, error);
        } catch (err) {
          logger.error({ event: "job.hook.error", jobId: job.id, hook: "onFailed", err }, "Error in onFailed hook");
        }
      }
    }
  }

  /**
   * Handle jobs that have exceeded their visibility timeout
   */
  private async handleStalledJobs(): Promise<void> {
    const now = new Date();

    // Find jobs that are marked as processing but visibility has expired
    const stalledJobs = await db
      .update(jobs)
      .set({
        status: "stalled",
        handlerId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.status, "processing"),
          lte(jobs.visibleAt, now)
        )
      )
      .returning({ id: jobs.id });

    if (stalledJobs.length > 0) {
      logger.warn({ event: "queue.stalled_jobs", count: stalledJobs.length, jobIds: stalledJobs.map(j => j.id) }, "Found stalled jobs");
    }
  }

  /**
   * Extend the visibility timeout for a job
   */
  async extendVisibility(jobId: string): Promise<boolean> {
    const now = new Date();
    const visibleAt = new Date(now.getTime() + this.config.visibilityTimeout);

    const result = await db
      .update(jobs)
      .set({
        visibleAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.handlerId, this.config.handlerId)
        )
      )
      .returning({ id: jobs.id });

    return result.length > 0;
  }

  /**
   * Register this handler in the heartbeat table
   */
  private async registerHandler(): Promise<void> {
    const now = new Date();

    await db
      .insert(queueHandlerHeartbeat)
      .values({
        id: this.config.handlerId,
        lastHeartbeat: now,
        status: "alive",
        hostname: typeof process !== "undefined" ? process.env.HOSTNAME : undefined,
        pid: typeof process !== "undefined" ? process.pid : undefined,
        version: "1.0.0",
        jobsProcessed: 0,
        jobsFailed: 0,
        startedAt: now,
        stoppedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: queueHandlerHeartbeat.id,
        set: {
          lastHeartbeat: now,
          status: "alive",
          startedAt: now,
          stoppedAt: null,
          updatedAt: now,
        },
      });
  }

  /**
   * Mark this handler as stopped in the heartbeat table
   */
  private async unregisterHandler(): Promise<void> {
    const now = new Date();

    await db
      .update(queueHandlerHeartbeat)
      .set({
        status: "dead",
        stoppedAt: now,
        jobsProcessed: this.stats.jobsProcessed,
        jobsFailed: this.stats.jobsFailed,
        updatedAt: now,
      })
      .where(eq(queueHandlerHeartbeat.id, this.config.handlerId));
  }

  /**
   * Start sending periodic heartbeats
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Send initial heartbeat
    this.sendHeartbeat().catch((err) => {
      logger.error({ event: "queue.heartbeat.error", handlerId: this.config.handlerId, err }, "Error sending initial heartbeat");
    });
  }

  /**
   * Send a heartbeat to indicate this handler is alive
   */
  private async sendHeartbeat(): Promise<void> {
    const now = new Date();
    this.stats.lastHeartbeat = now;

    await db
      .update(queueHandlerHeartbeat)
      .set({
        lastHeartbeat: now,
        jobsProcessed: this.stats.jobsProcessed,
        jobsFailed: this.stats.jobsFailed,
        updatedAt: now,
      })
      .where(eq(queueHandlerHeartbeat.id, this.config.handlerId));

    this.emit({ type: "handler:heartbeat", handlerId: this.config.handlerId });
  }
}

/**
 * Check if any handlers are alive
 */
export async function getAliveHandlers(): Promise<
  Array<{
    id: string;
    lastHeartbeat: Date;
    jobsProcessed: number;
    jobsFailed: number;
  }>
> {
  const heartbeatTimeout = DEFAULT_QUEUE_CONFIG.heartbeatTimeout;
  const cutoff = new Date(Date.now() - heartbeatTimeout);

  const handlers = await db
    .select()
    .from(queueHandlerHeartbeat)
    .where(
      and(
        eq(queueHandlerHeartbeat.status, "alive"),
        sql`${queueHandlerHeartbeat.lastHeartbeat} >= ${cutoff}`
      )
    );

  return handlers.map((h) => ({
    id: h.id,
    lastHeartbeat: h.lastHeartbeat,
    jobsProcessed: h.jobsProcessed,
    jobsFailed: h.jobsFailed,
  }));
}

/**
 * Mark dead handlers as dead in the database
 */
export async function cleanupDeadHandlers(): Promise<number> {
  const heartbeatTimeout = DEFAULT_QUEUE_CONFIG.heartbeatTimeout;
  const cutoff = new Date(Date.now() - heartbeatTimeout);
  const now = new Date();

  const result = await db
    .update(queueHandlerHeartbeat)
    .set({
      status: "dead",
      updatedAt: now,
    })
    .where(
      and(
        eq(queueHandlerHeartbeat.status, "alive"),
        lte(queueHandlerHeartbeat.lastHeartbeat, cutoff)
      )
    )
    .returning({ id: queueHandlerHeartbeat.id });

  return result.length;
}
