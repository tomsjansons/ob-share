/**
 * Queue Scheduler
 *
 * Manages the scheduled execution of the queue handler:
 * - Runs every 30 minutes by default
 * - Can be triggered manually
 * - Monitors handler health
 * - Cleans up dead handlers and old jobs
 */

import { QueueHandler, getAliveHandlers, cleanupDeadHandlers } from "./queue-handler";
import { JobRegistry } from "./registry";
import { cleanupOldJobs, getHandlerHealth, getQueueStats } from "./job-service";
import type { QueueEventHandler } from "./types";

/**
 * Default interval: 30 minutes in milliseconds
 */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Cleanup interval: Run cleanup every 6 hours
 */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Days to keep completed/failed jobs
 */
const CLEANUP_OLDER_THAN_DAYS = 7;

export interface SchedulerConfig {
  /** Interval between queue processing runs (ms). Default: 30 minutes */
  intervalMs?: number;
  /** Whether to start processing immediately on init */
  runOnStart?: boolean;
  /** Maximum processing time before timeout (ms) */
  processingTimeout?: number;
  /** Whether to run cleanup tasks */
  enableCleanup?: boolean;
  /** How often to run cleanup (ms) */
  cleanupIntervalMs?: number;
  /** Days to keep old jobs */
  cleanupOlderThanDays?: number;
}

interface SchedulerStatus {
  isRunning: boolean;
  isProcessing: boolean;
  lastRun: Date | null;
  lastRunDuration: number | null;
  lastRunJobsProcessed: number;
  nextRun: Date | null;
  totalRuns: number;
  totalJobsProcessed: number;
  errors: Array<{ timestamp: Date; error: string }>;
}

/**
 * Queue Scheduler manages periodic queue processing
 */
export class QueueScheduler {
  private config: Required<SchedulerConfig>;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private handler: QueueHandler | null = null;
  private isProcessing = false;
  private eventHandlers: QueueEventHandler[] = [];

  private status: SchedulerStatus = {
    isRunning: false,
    isProcessing: false,
    lastRun: null,
    lastRunDuration: null,
    lastRunJobsProcessed: 0,
    nextRun: null,
    totalRuns: 0,
    totalJobsProcessed: 0,
    errors: [],
  };

  constructor(config?: SchedulerConfig) {
    this.config = {
      intervalMs: config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      runOnStart: config?.runOnStart ?? false,
      processingTimeout: config?.processingTimeout ?? 5 * 60 * 1000, // 5 minutes
      enableCleanup: config?.enableCleanup ?? true,
      cleanupIntervalMs: config?.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS,
      cleanupOlderThanDays: config?.cleanupOlderThanDays ?? CLEANUP_OLDER_THAN_DAYS,
    };
  }

  /**
   * Register an event handler
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
   * Start the scheduler
   */
  start(): void {
    if (this.status.isRunning) {
      console.warn("Scheduler is already running");
      return;
    }

    this.status.isRunning = true;
    console.log(
      `Queue scheduler started. Interval: ${this.config.intervalMs / 1000}s`
    );

    // Schedule next run
    this.scheduleNextRun();

    // Start cleanup timer if enabled
    if (this.config.enableCleanup) {
      this.cleanupTimer = setInterval(
        () => this.runCleanup(),
        this.config.cleanupIntervalMs
      );
    }

    // Run immediately if configured
    if (this.config.runOnStart) {
      this.triggerProcessing().catch((err) => {
        console.error("Error during initial processing:", err);
      });
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.status.isRunning) {
      return;
    }

    console.log("Queue scheduler stopping...");

    // Clear timers
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop handler if processing
    if (this.handler) {
      await this.handler.stop();
      this.handler = null;
    }

    this.status.isRunning = false;
    this.status.nextRun = null;
    console.log("Queue scheduler stopped");
  }

  /**
   * Manually trigger queue processing
   */
  async triggerProcessing(): Promise<{
    success: boolean;
    jobsProcessed: number;
    duration: number;
    error?: string;
  }> {
    if (this.isProcessing) {
      return {
        success: false,
        jobsProcessed: 0,
        duration: 0,
        error: "Processing is already in progress",
      };
    }

    this.isProcessing = true;
    this.status.isProcessing = true;
    const startTime = Date.now();

    try {
      // Create a new handler for this run
      const definitions = JobRegistry.getAll();
      this.handler = new QueueHandler(definitions);

      // Forward events
      for (const eventHandler of this.eventHandlers) {
        this.handler.on(eventHandler);
      }

      // Start the handler
      await this.handler.start();

      // Process jobs
      const jobsProcessed = await this.handler.triggerPoll();

      // Wait for current jobs to complete (with timeout)
      const deadline = Date.now() + this.config.processingTimeout;
      while (this.handler.getStats().currentJobs.length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Stop the handler
      await this.handler.stop();
      this.handler = null;

      const duration = Date.now() - startTime;

      // Update status
      this.status.lastRun = new Date();
      this.status.lastRunDuration = duration;
      this.status.lastRunJobsProcessed = jobsProcessed;
      this.status.totalRuns++;
      this.status.totalJobsProcessed += jobsProcessed;

      console.log(
        `Queue processing completed. Jobs: ${jobsProcessed}, Duration: ${duration}ms`
      );

      return { success: true, jobsProcessed, duration };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;

      // Record error
      this.status.errors.push({ timestamp: new Date(), error });
      if (this.status.errors.length > 10) {
        this.status.errors.shift();
      }

      console.error("Queue processing error:", error);

      // Clean up handler
      if (this.handler) {
        try {
          await this.handler.stop();
        } catch {
          // Ignore cleanup errors
        }
        this.handler = null;
      }

      return { success: false, jobsProcessed: 0, duration, error };
    } finally {
      this.isProcessing = false;
      this.status.isProcessing = false;

      // Schedule next run if still running
      if (this.status.isRunning) {
        this.scheduleNextRun();
      }
    }
  }

  /**
   * Get current scheduler status
   */
  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<
    Awaited<ReturnType<typeof getQueueStats>> & {
      handlers: Awaited<ReturnType<typeof getAliveHandlers>>;
    }
  > {
    const [stats, handlers] = await Promise.all([
      getQueueStats(),
      getAliveHandlers(),
    ]);

    return {
      ...stats,
      handlers,
    };
  }

  /**
   * Get handler health information
   */
  async getHealth(): Promise<{
    schedulerRunning: boolean;
    isProcessing: boolean;
    aliveHandlers: number;
    lastHeartbeat: Date | null;
    oldestPendingJob: Date | null;
    queueBacklog: number;
  }> {
    const health = await getHandlerHealth();
    const stats = await getQueueStats();

    return {
      schedulerRunning: this.status.isRunning,
      isProcessing: this.isProcessing,
      aliveHandlers: health.aliveHandlers,
      lastHeartbeat: health.lastHeartbeat,
      oldestPendingJob: health.oldestPendingJob,
      queueBacklog: stats.pending + stats.stalled,
    };
  }

  /**
   * Schedule the next processing run
   */
  private scheduleNextRun(): void {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
    }

    this.status.nextRun = new Date(Date.now() + this.config.intervalMs);

    this.intervalTimer = setTimeout(() => {
      this.triggerProcessing().catch((err) => {
        console.error("Error during scheduled processing:", err);
      });
    }, this.config.intervalMs);
  }

  /**
   * Run cleanup tasks
   */
  private async runCleanup(): Promise<void> {
    try {
      console.log("Running queue cleanup...");

      // Clean up dead handlers
      const deadHandlers = await cleanupDeadHandlers();
      if (deadHandlers > 0) {
        console.log(`Cleaned up ${deadHandlers} dead handlers`);
      }

      // Clean up old jobs
      const oldJobs = await cleanupOldJobs(this.config.cleanupOlderThanDays);
      if (oldJobs > 0) {
        console.log(`Cleaned up ${oldJobs} old jobs`);
      }
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  }
}

// Global scheduler instance
let globalScheduler: QueueScheduler | null = null;

/**
 * Get or create the global scheduler instance
 */
export function getGlobalScheduler(config?: SchedulerConfig): QueueScheduler {
  if (!globalScheduler) {
    globalScheduler = new QueueScheduler(config);
  }
  return globalScheduler;
}
