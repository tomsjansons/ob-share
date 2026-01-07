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
 * Yield to the event loop to allow HTTP requests to be processed.
 * This is necessary because better-sqlite3 is synchronous and blocks the event loop.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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

  private emit(event: QueueEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => logger.error({ event: "queue.event.error", err, eventType: event.type }, "Event handler error"));
        }
      } catch (err) {
        logger.error({ event: "queue.event.error", err, eventType: event.type }, "Event handler error");
      }
    }
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
   * Stop the queue handler gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning || this.isStopping) {
      return;
    }

    this.isStopping = true;
    logger.debug({ event: "queue.handler.stopping", handlerId: this.config.handlerId }, "Queue handler stopping");

    // Stop polling
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Cancel all running jobs
    for (const [jobId, controller] of this.currentJobs) {
      logger.info({ event: "job.cancelling", jobId, handlerId: this.config.handlerId }, "Cancelling job");
      controller.abort();
    }

    // Wait for jobs to complete (with timeout)
    const deadline = Date.now() + this.config.shutdownTimeout;
    while (this.currentJobs.size > 0 && Date.now() < deadline) {
      // Yield to event loop to keep HTTP responsive during shutdown
      await yieldToEventLoop();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Mark handler as stopped
    await this.unregisterHandler();

    this.isRunning = false;
    this.isStopping = false;

    this.emit({ type: "handler:stopped", handlerId: this.config.handlerId });
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
      const claimed = await this.claimJob(job.id);
      if (claimed) {
        processedCount++;
        logger.debug({
          event: "queue.process.job_claimed",
          handlerId: this.config.handlerId,
          jobId: job.id,
          jobType: job.type,
        });
        // Process job in background (don't await)
        this.processJob(job as JobRecord).catch((err) => {
          logger.error({ event: "job.process.error", jobId: job.id, jobType: job.type, err }, "Error processing job");
        });
      } else {
        logger.debug({
          event: "queue.process.job_claim_failed",
          handlerId: this.config.handlerId,
          jobId: job.id,
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
   * Claim a job for processing by setting visibility timeout
   */
  private async claimJob(jobId: string): Promise<boolean> {
    const now = new Date();
    const visibleAt = new Date(now.getTime() + this.config.visibilityTimeout);

    // Atomic update - only succeeds if job is still claimable
    const result = await db
      .update(jobs)
      .set({
        status: "processing",
        visibleAt,
        handlerId: this.config.handlerId,
        startedAt: now,
        updatedAt: now,
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
