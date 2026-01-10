/**
 * Job Queue Type Definitions
 *
 * This module defines the core types and interfaces for the async job queue system.
 * Jobs are composed of multiple idempotent phases that can be executed independently.
 */

// Re-export status types from schema
export type { JobStatus, PhaseStatus } from "../db/schema";
import type { JobStatus, PhaseStatus } from "../db/schema";

// ============================================================================
// Core Job Types
// ============================================================================

/**
 * Job priority levels
 */
export enum JobPriority {
  LOW = 0,
  NORMAL = 10,
  HIGH = 20,
  CRITICAL = 100,
}

/**
 * Configuration for creating a new job
 */
export interface CreateJobConfig<TPayload = unknown> {
  type: string;
  payload: TPayload;
  priority?: JobPriority;
  maxRetries?: number;
  scheduledFor?: Date;
  userId?: string;
}

/**
 * Represents a job record from the database
 */
export interface JobRecord {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  payload: string; // JSON string
  result: string | null;
  maxRetries: number;
  retryCount: number;
  visibleAt: Date;
  scheduledFor: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string | null;
  handlerId: string | null;
}

/**
 * Represents a phase record from the database
 */
export interface PhaseRecord {
  id: string;
  jobId: string;
  name: string;
  phaseOrder: number;
  status: PhaseStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Phase Definition Types
// ============================================================================

/**
 * Context passed to phase execution functions
 */
export interface PhaseContext<TPayload = unknown, TPhaseInput = unknown> {
  job: {
    id: string;
    type: string;
    payload: TPayload;
    retryCount: number;
  };
  phase: {
    id: string;
    name: string;
    phaseOrder: number;
    input: TPhaseInput | null;
    retryCount: number;
  };
  handlerId: string;
  signal: AbortSignal; // For cancellation support
}

/**
 * Result from executing a phase
 */
export interface PhaseResult<TOutput = unknown> {
  success: boolean;
  output?: TOutput;
  error?: string;
  /** If true, the phase should be retried later */
  shouldRetry?: boolean;
  /** If true, skip all remaining phases and complete the job */
  skipRemaining?: boolean;
}

/**
 * Definition of a single phase within a job
 */
export interface PhaseDefinition<
  TPayload = unknown,
  TPhaseInput = unknown,
  TPhaseOutput = unknown,
> {
  name: string;
  /** Maximum retries for this specific phase */
  maxRetries?: number;
  /**
   * Execute the phase logic.
   * Must be idempotent - safe to run multiple times with the same input.
   */
  execute: (
    ctx: PhaseContext<TPayload, TPhaseInput>
  ) => Promise<PhaseResult<TPhaseOutput>>;
  /**
   * Optional: Transform the previous phase's output to this phase's input.
   * If not provided, the previous output is passed directly.
   */
  transformInput?: (
    previousOutput: unknown,
    payload: TPayload
  ) => TPhaseInput | null;
  /**
   * Optional: Condition to check before running this phase.
   * If returns false, the phase is skipped.
   */
  shouldRun?: (ctx: PhaseContext<TPayload, TPhaseInput>) => boolean;
}

// ============================================================================
// Job Definition Types
// ============================================================================

/**
 * Definition of a job type with its phases
 */
export interface JobDefinition<TPayload = unknown> {
  /** Unique identifier for this job type */
  type: string;
  /** Human-readable description */
  description?: string;
  /** Default priority for jobs of this type */
  defaultPriority?: JobPriority;
  /** Default max retries for jobs of this type */
  defaultMaxRetries?: number;
  /**
   * Ordered list of phases to execute.
   * Phases are executed in order, and each must complete before the next starts.
   */
  phases: PhaseDefinition<TPayload, unknown, unknown>[];
  /**
   * Optional: Validate the payload before creating the job
   */
  validatePayload?: (payload: unknown) => payload is TPayload;
  /**
   * Optional: Called when all phases complete successfully
   */
  onComplete?: (job: JobRecord, result: unknown) => Promise<void>;
  /**
   * Optional: Called when the job fails after all retries
   */
  onFailed?: (job: JobRecord, error: string) => Promise<void>;
}

// ============================================================================
// Queue Handler Types
// ============================================================================

/**
 * Configuration for the queue handler
 */
export interface QueueHandlerConfig {
  /** Unique identifier for this handler instance */
  handlerId?: string;
  /** How often to poll for new jobs (ms) */
  pollInterval?: number;
  /** How long before a job becomes visible again if not completed (ms) */
  visibilityTimeout?: number;
  /** How often to send heartbeats (ms) */
  heartbeatInterval?: number;
  /** How long before a handler is considered dead (ms) */
  heartbeatTimeout?: number;
  /** Maximum number of concurrent jobs to process */
  concurrency?: number;
  /** Maximum time to wait for graceful shutdown (ms) */
  shutdownTimeout?: number;
  /** How often to extend visibility during phase execution (ms). Should be less than visibilityTimeout. */
  visibilityHeartbeatInterval?: number;
  /** Maximum total execution time for a job across all retries (ms). 0 = no limit. */
  maxJobExecutionTime?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_QUEUE_CONFIG: Required<QueueHandlerConfig> = {
  handlerId: "", // Generated at runtime
  pollInterval: 5000, // 5 seconds
  visibilityTimeout: 300000, // 5 minutes
  heartbeatInterval: 30000, // 30 seconds
  heartbeatTimeout: 120000, // 2 minutes
  concurrency: 1, // Single job at a time
  shutdownTimeout: 30000, // 30 seconds
  visibilityHeartbeatInterval: 60000, // 1 minute - extend visibility every minute during execution
  maxJobExecutionTime: 3600000, // 1 hour max execution time for a single job
};

/**
 * Statistics from the queue handler
 */
export interface QueueStats {
  handlerId: string;
  status: "running" | "stopped" | "stopping";
  startedAt: Date;
  jobsProcessed: number;
  jobsFailed: number;
  lastHeartbeat: Date;
  currentJobs: string[]; // IDs of jobs currently being processed
}

// ============================================================================
// Job Queue Events
// ============================================================================

export type QueueEvent =
  | { type: "job:created"; job: JobRecord }
  | { type: "job:started"; job: JobRecord }
  | { type: "job:completed"; job: JobRecord; result: unknown }
  | { type: "job:failed"; job: JobRecord; error: string }
  | { type: "job:retrying"; job: JobRecord; attempt: number }
  | { type: "phase:started"; job: JobRecord; phase: PhaseRecord }
  | { type: "phase:completed"; job: JobRecord; phase: PhaseRecord }
  | { type: "phase:failed"; job: JobRecord; phase: PhaseRecord; error: string }
  | { type: "handler:started"; handlerId: string }
  | { type: "handler:stopped"; handlerId: string }
  | { type: "handler:heartbeat"; handlerId: string };

export type QueueEventHandler = (event: QueueEvent) => void | Promise<void>;
