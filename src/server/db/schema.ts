import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Better Auth required tables
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// Allow list table for authorized GitHub usernames
export const allowList = sqliteTable("allow_list", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  githubUsername: text("github_username").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/**
 * Location permission status enum values:
 * - not_asked: User hasn't been asked for location permission yet
 * - granted: User has granted location permission
 * - denied: User has denied location permission
 */
export type LocationPermissionStatus = "not_asked" | "granted" | "denied";

/**
 * Audio permission status enum values:
 * - not_asked: User hasn't been asked for audio permission yet
 * - granted: User has granted audio permission
 * - denied: User has denied audio permission
 */
export type AudioPermissionStatus = "not_asked" | "granted" | "denied";

/**
 * Text LLM provider enum values:
 * - anthropic: Use Anthropic Claude models
 * - openai: Use OpenAI GPT models
 */
export type TextLlmProvider = "anthropic" | "openai";

// User settings table for vault configuration
export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  vaultName: text("vault_name"),
  incomingFolder: text("incoming_folder"),
  locationPermission: text("location_permission")
    .$type<LocationPermissionStatus>()
    .notNull()
    .default("not_asked"),
  audioPermission: text("audio_permission")
    .$type<AudioPermissionStatus>()
    .notNull()
    .default("not_asked"),
  // File check interval in seconds (default: 10 seconds)
  fileCheckInterval: integer("file_check_interval").notNull().default(10),
  // OpenAI API configuration (for audio transcription)
  openaiApiKey: text("openai_api_key"),
  openaiModel: text("openai_model").notNull().default("gpt-4o-audio-preview"),
  // Text LLM configuration (for URL summarization and text analysis)
  textLlmProvider: text("text_llm_provider").$type<TextLlmProvider>().notNull().default("anthropic"),
  textLlmApiKey: text("text_llm_api_key"),
  textLlmModel: text("text_llm_model").notNull().default("claude-sonnet-4-20250514"),
  // Maximum retry attempts for extraction (default: 5)
  maxRetries: integer("max_retries").notNull().default(5),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// Job Queue Tables
// ============================================================================

/**
 * Job status enum values:
 * - pending: Job is waiting to be picked up
 * - processing: Job is currently being processed
 * - completed: Job finished successfully
 * - failed: Job failed after all retries
 * - stalled: Job was picked up but handler stopped responding (visibility timeout expired)
 */
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "stalled";

/**
 * Phase status enum values:
 * - pending: Phase not yet executed
 * - running: Phase is currently executing
 * - completed: Phase finished successfully
 * - failed: Phase failed (may be retried)
 * - skipped: Phase was skipped (e.g., conditional logic)
 */
export type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

// Jobs table - main queue for async tasks
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), // UUID
  type: text("type").notNull(), // Job type identifier (e.g., "sync-vault", "process-share")
  status: text("status").$type<JobStatus>().notNull().default("pending"),
  priority: integer("priority").notNull().default(0), // Higher = more urgent
  payload: text("payload").notNull(), // JSON serialized job data
  result: text("result"), // JSON serialized result or error

  // Retry configuration
  maxRetries: integer("max_retries").notNull().default(3),
  retryCount: integer("retry_count").notNull().default(0),

  // Visibility timeout - prevents multiple handlers from picking up same job
  // When a handler picks up a job, it sets visibleAt to future time
  // Other handlers won't see the job until visibleAt has passed
  visibleAt: integer("visible_at", { mode: "timestamp" }).notNull(),

  // Scheduling - job won't be picked up until this time
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }).notNull(),

  // Processing tracking
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),

  // Audit fields
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),

  // Optional user association
  userId: text("user_id").references(() => user.id),

  // Handler tracking - which handler instance is processing this job
  handlerId: text("handler_id"),
});

// Job phases table - tracks individual idempotent phases within a job
export const jobPhases = sqliteTable("job_phases", {
  id: text("id").primaryKey(), // UUID
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Phase identifier
  order: integer("order").notNull(), // Execution order
  status: text("status").$type<PhaseStatus>().notNull().default("pending"),

  // Phase-specific data
  input: text("input"), // JSON serialized input for this phase
  output: text("output"), // JSON serialized output from this phase
  error: text("error"), // Error message if failed

  // Retry tracking for individual phases
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),

  // Timing
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),

  // Audit fields
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Queue handler heartbeat table - tracks handler health
export const queueHandlerHeartbeat = sqliteTable("queue_handler_heartbeat", {
  id: text("id").primaryKey(), // Handler instance ID
  lastHeartbeat: integer("last_heartbeat", { mode: "timestamp" }).notNull(),
  status: text("status").$type<"alive" | "dead">().notNull().default("alive"),

  // Handler metadata
  hostname: text("hostname"),
  pid: integer("pid"),
  version: text("version"),

  // Statistics
  jobsProcessed: integer("jobs_processed").notNull().default(0),
  jobsFailed: integer("jobs_failed").notNull().default(0),

  // Lifecycle
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Queue processing lock - ensures only one handler processes the queue at a time
export const queueLock = sqliteTable("queue_lock", {
  id: text("id").primaryKey().default("global"), // Single row lock
  handlerId: text("handler_id").notNull(),
  acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// Periodic Job Schedules
// ============================================================================

/**
 * Periodic job schedules - defines jobs that run at regular intervals
 * Each schedule tracks when the job last ran and when it should run next
 */
export const periodicJobSchedules = sqliteTable("periodic_job_schedules", {
  id: text("id").primaryKey(), // Unique identifier for this schedule (e.g., "file-checker")
  jobType: text("job_type").notNull(), // The job type to create
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

  // Interval configuration (in milliseconds)
  intervalMs: integer("interval_ms").notNull(),

  // Payload template (JSON) - merged with dynamic data when creating jobs
  payloadTemplate: text("payload_template"),

  // Tracking
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp" }),
  lastJobId: text("last_job_id"), // ID of the last job created

  // Statistics
  totalRuns: integer("total_runs").notNull().default(0),
  successfulRuns: integer("successful_runs").notNull().default(0),
  failedRuns: integer("failed_runs").notNull().default(0),

  // Audit fields
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
