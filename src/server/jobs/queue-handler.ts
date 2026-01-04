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
          result.catch((err) => console.error("Event handler error:", err));
        }
      } catch (err) {
        console.error("Event handler error:", err);
      }
    }
  }

  /**
   * Start the queue handler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("Queue handler is already running");
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

    console.log(`Queue handler ${this.config.handlerId} started`);

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
    console.log(`Queue handler ${this.config.handlerId} stopping...`);

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
      console.log(`Cancelling job ${jobId}`);
      controller.abort();
    }

    // Wait for jobs to complete (with timeout)
    const deadline = Date.now() + this.config.shutdownTimeout;
    while (this.currentJobs.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Mark handler as stopped
    await this.unregisterHandler();

    this.isRunning = false;
    this.isStopping = false;

    this.emit({ type: "handler:stopped", handlerId: this.config.handlerId });
    console.log(`Queue handler ${this.config.handlerId} stopped`);
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
      return;
    }

    try {
      await this.processPendingJobs();
    } catch (err) {
      console.error("Error during poll:", err);
    }

    // Schedule next poll
    if (this.isRunning && !this.isStopping) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval);
    }
  }

  /**
   * Process all pending jobs
   */
  private async processPendingJobs(): Promise<number> {
    // First, handle stalled jobs (visibility timeout expired)
    await this.handleStalledJobs();

    // Get available slots
    const availableSlots = this.config.concurrency - this.currentJobs.size;
    if (availableSlots <= 0) {
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

    let processedCount = 0;

    for (const job of pendingJobs) {
      // Try to claim the job by updating visibility timeout
      const claimed = await this.claimJob(job.id);
      if (claimed) {
        processedCount++;
        // Process job in background (don't await)
        this.processJob(job as JobRecord).catch((err) => {
          console.error(`Error processing job ${job.id}:`, err);
        });
      }
    }

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
        .orderBy(asc(jobPhases.order));

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
          order: index,
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

    // Call onComplete hook
    const definition = this.jobDefinitions.get(job.type);
    if (definition?.onComplete) {
      try {
        await definition.onComplete(job, result);
      } catch (err) {
        console.error(`Error in onComplete hook for job ${job.id}:`, err);
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

      // Call onFailed hook
      const definition = this.jobDefinitions.get(job.type);
      if (definition?.onFailed) {
        try {
          await definition.onFailed(job, error);
        } catch (err) {
          console.error(`Error in onFailed hook for job ${job.id}:`, err);
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
      console.warn(`Found ${stalledJobs.length} stalled jobs`);
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
      console.error("Error sending initial heartbeat:", err);
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
