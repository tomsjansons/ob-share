/**
 * Job Service
 *
 * Provides a high-level API for creating, querying, and managing jobs.
 * This is the main interface for interacting with the job queue.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { jobs, jobPhases, queueHandlerHeartbeat } from "../db/schema";
import { eq, and, or, desc, asc, lte, sql, count } from "drizzle-orm";
import type {
  CreateJobConfig,
  JobRecord,
  PhaseRecord,
  JobDefinition,
  JobStatus,
  JobPriority,
} from "./types";

/**
 * Create a new job and add it to the queue
 */
export async function createJob<TPayload = unknown>(
  config: CreateJobConfig<TPayload>,
  definitions?: Map<string, JobDefinition>
): Promise<JobRecord> {
  const now = new Date();
  const id = randomUUID();
  const scheduledFor = config.scheduledFor || now;

  // Validate payload if definition exists
  if (definitions) {
    const definition = definitions.get(config.type);
    if (definition?.validatePayload) {
      if (!definition.validatePayload(config.payload)) {
        throw new Error(`Invalid payload for job type: ${config.type}`);
      }
    }
  }

  const jobRecord = {
    id,
    type: config.type,
    status: "pending" as JobStatus,
    priority: config.priority ?? 0,
    payload: JSON.stringify(config.payload),
    result: null,
    maxRetries: config.maxRetries ?? 3,
    retryCount: 0,
    visibleAt: scheduledFor,
    scheduledFor,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    userId: config.userId || null,
    handlerId: null,
  };

  await db.insert(jobs).values(jobRecord);

  return jobRecord;
}

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<JobRecord | null> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  return job as JobRecord | null;
}

/**
 * Get phases for a job
 */
export async function getJobPhases(jobId: string): Promise<PhaseRecord[]> {
  const phases = await db
    .select()
    .from(jobPhases)
    .where(eq(jobPhases.jobId, jobId))
    .orderBy(asc(jobPhases.order));

  return phases as PhaseRecord[];
}

/**
 * Get a job with its phases
 */
export async function getJobWithPhases(
  jobId: string
): Promise<{ job: JobRecord; phases: PhaseRecord[] } | null> {
  const job = await getJob(jobId);
  if (!job) {
    return null;
  }

  const phases = await getJobPhases(jobId);
  return { job, phases };
}

/**
 * List jobs with optional filters
 */
export async function listJobs(options?: {
  status?: JobStatus | JobStatus[];
  type?: string;
  userId?: string;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "updatedAt" | "priority";
  order?: "asc" | "desc";
}): Promise<{ jobs: JobRecord[]; total: number }> {
  const {
    status,
    type,
    userId,
    limit = 50,
    offset = 0,
    orderBy = "createdAt",
    order = "desc",
  } = options || {};

  // Build where conditions
  const conditions: ReturnType<typeof eq>[] = [];

  if (status) {
    if (Array.isArray(status)) {
      conditions.push(or(...status.map((s) => eq(jobs.status, s)))!);
    } else {
      conditions.push(eq(jobs.status, status));
    }
  }

  if (type) {
    conditions.push(eq(jobs.type, type));
  }

  if (userId) {
    conditions.push(eq(jobs.userId, userId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [countResult] = await db
    .select({ count: count() })
    .from(jobs)
    .where(whereClause);

  const total = countResult?.count || 0;

  // Get jobs
  const orderColumn =
    orderBy === "priority"
      ? jobs.priority
      : orderBy === "updatedAt"
        ? jobs.updatedAt
        : jobs.createdAt;

  const orderDirection = order === "asc" ? asc : desc;

  const jobList = await db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(orderDirection(orderColumn))
    .limit(limit)
    .offset(offset);

  return { jobs: jobList as JobRecord[], total };
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  stalled: number;
  total: number;
  byType: Record<string, number>;
}> {
  const stats = await db
    .select({
      status: jobs.status,
      count: count(),
    })
    .from(jobs)
    .groupBy(jobs.status);

  const byType = await db
    .select({
      type: jobs.type,
      count: count(),
    })
    .from(jobs)
    .where(or(eq(jobs.status, "pending"), eq(jobs.status, "processing")))
    .groupBy(jobs.type);

  const result: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    stalled: number;
    total: number;
    byType: Record<string, number>;
  } = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    stalled: 0,
    total: 0,
    byType: {},
  };

  for (const row of stats) {
    const status = row.status as JobStatus;
    switch (status) {
      case "pending":
        result.pending = row.count;
        break;
      case "processing":
        result.processing = row.count;
        break;
      case "completed":
        result.completed = row.count;
        break;
      case "failed":
        result.failed = row.count;
        break;
      case "stalled":
        result.stalled = row.count;
        break;
    }
    result.total += row.count;
  }

  for (const row of byType) {
    result.byType[row.type] = row.count;
  }

  return result;
}

/**
 * Cancel a pending or stalled job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const now = new Date();

  const result = await db
    .update(jobs)
    .set({
      status: "failed",
      result: JSON.stringify({ error: "Job cancelled by user" }),
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        or(eq(jobs.status, "pending"), eq(jobs.status, "stalled"))
      )
    )
    .returning({ id: jobs.id });

  return result.length > 0;
}

/**
 * Retry a failed job
 */
export async function retryJob(jobId: string): Promise<boolean> {
  const now = new Date();

  // Get the job to check current state
  const job = await getJob(jobId);
  if (!job || job.status !== "failed") {
    return false;
  }

  // Reset job to pending
  await db
    .update(jobs)
    .set({
      status: "pending",
      result: null,
      retryCount: 0,
      visibleAt: now,
      scheduledFor: now,
      startedAt: null,
      completedAt: null,
      handlerId: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));

  // Reset phases to pending
  await db
    .update(jobPhases)
    .set({
      status: "pending",
      output: null,
      error: null,
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(eq(jobPhases.jobId, jobId));

  return true;
}

/**
 * Delete old completed/failed jobs
 */
export async function cleanupOldJobs(olderThanDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(jobs)
    .where(
      and(
        or(eq(jobs.status, "completed"), eq(jobs.status, "failed")),
        lte(jobs.completedAt, cutoff)
      )
    )
    .returning({ id: jobs.id });

  return result.length;
}

/**
 * Get pending job count (for health checks)
 */
export async function getPendingJobCount(): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(jobs)
    .where(
      or(
        eq(jobs.status, "pending"),
        eq(jobs.status, "processing"),
        eq(jobs.status, "stalled")
      )
    );

  return result?.count || 0;
}

/**
 * Get handler health information
 */
export async function getHandlerHealth(): Promise<{
  aliveHandlers: number;
  lastHeartbeat: Date | null;
  oldestPendingJob: Date | null;
}> {
  const heartbeatTimeout = 120000; // 2 minutes
  const cutoff = new Date(Date.now() - heartbeatTimeout);

  // Count alive handlers
  const [handlerResult] = await db
    .select({ count: count() })
    .from(queueHandlerHeartbeat)
    .where(
      and(
        eq(queueHandlerHeartbeat.status, "alive"),
        sql`${queueHandlerHeartbeat.lastHeartbeat} >= ${cutoff}`
      )
    );

  // Get latest heartbeat
  const [latestHeartbeat] = await db
    .select({ lastHeartbeat: queueHandlerHeartbeat.lastHeartbeat })
    .from(queueHandlerHeartbeat)
    .where(eq(queueHandlerHeartbeat.status, "alive"))
    .orderBy(desc(queueHandlerHeartbeat.lastHeartbeat))
    .limit(1);

  // Get oldest pending job
  const [oldestJob] = await db
    .select({ createdAt: jobs.createdAt })
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(asc(jobs.createdAt))
    .limit(1);

  return {
    aliveHandlers: handlerResult?.count || 0,
    lastHeartbeat: latestHeartbeat?.lastHeartbeat || null,
    oldestPendingJob: oldestJob?.createdAt || null,
  };
}
