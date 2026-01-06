/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for initializing background services like the job scheduler.
 *
 * The job scheduler handles:
 * - Regular job queue processing
 * - Periodic jobs (like file checking) via the periodic job system
 *
 * IMPORTANT: We defer the initial run of the scheduler to avoid
 * blocking the event loop during startup. better-sqlite3 is synchronous
 * and can block the event loop during database operations.
 */

export async function register() {
  const registerStart = Date.now();

  // Dynamic import to avoid issues during build
  const { logger, getElapsedMs } = await import("@/lib/logger");
  const startupLogger = logger.child({ module: "startup" });

  startupLogger.info({
    event: "instrumentation.register.start",
    elapsedMs: getElapsedMs(),
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    nextRuntime: process.env.NEXT_RUNTIME,
  }, "Next.js instrumentation register called");

  // Only initialize services in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // Initialize workflow system
      startupLogger.info({
        event: "instrumentation.workflows.initializing",
        elapsedMs: getElapsedMs(),
      }, "Initializing workflow system");

      const { initializeWorkflowSystem } = await import("@/server/workflows");
      initializeWorkflowSystem();

      startupLogger.info({
        event: "instrumentation.workflows.initialized",
        elapsedMs: getElapsedMs(),
      }, "Workflow system initialized");

      // Register the file checker job
      startupLogger.info({
        event: "instrumentation.file-checker-job.registering",
        elapsedMs: getElapsedMs(),
      }, "Registering file checker job");

      const { JobRegistry } = await import("@/server/jobs");
      const { fileCheckerJob, FILE_CHECKER_SCHEDULE_ID, DEFAULT_FILE_CHECK_INTERVAL_MS } = await import("@/server/jobs/file-checker-job");
      JobRegistry.register(fileCheckerJob);

      startupLogger.info({
        event: "instrumentation.file-checker-job.registered",
        elapsedMs: getElapsedMs(),
      }, "File checker job registered");

      // Start job queue scheduler
      // Runs every 10 seconds to support periodic jobs like file checking
      startupLogger.info({
        event: "instrumentation.scheduler.starting",
        elapsedMs: getElapsedMs(),
      }, "Starting job queue scheduler");

      const { getGlobalScheduler } = await import("@/server/jobs/scheduler");
      const scheduler = getGlobalScheduler({
        intervalMs: 10 * 1000, // Run every 10 seconds to support periodic jobs
        runOnStart: false, // Don't run immediately - defer to avoid blocking
      });
      scheduler.start();

      startupLogger.info({
        event: "instrumentation.scheduler.started",
        elapsedMs: getElapsedMs(),
      }, "Job queue scheduler started");

      // Defer the initial setup using setImmediate to allow the HTTP server to start first
      // This ensures the event loop is free to handle HTTP requests during startup
      setImmediate(async () => {
        try {
          // Register the file checker periodic schedule
          startupLogger.info({
            event: "instrumentation.periodic.registering",
            elapsedMs: getElapsedMs(),
          }, "Registering periodic file checker schedule");

          const { registerPeriodicJob } = await import("@/server/jobs");
          await registerPeriodicJob({
            id: FILE_CHECKER_SCHEDULE_ID,
            jobType: "file-checker",
            intervalMs: DEFAULT_FILE_CHECK_INTERVAL_MS, // 10 seconds
          });

          startupLogger.info({
            event: "instrumentation.periodic.registered",
            scheduleId: FILE_CHECKER_SCHEDULE_ID,
            intervalMs: DEFAULT_FILE_CHECK_INTERVAL_MS,
            elapsedMs: getElapsedMs(),
          }, "Periodic file checker schedule registered");

          // Run initial scheduler processing
          startupLogger.info({
            event: "instrumentation.deferred.scheduler",
            elapsedMs: getElapsedMs(),
          }, "Running deferred scheduler processing");

          const result = await scheduler.triggerProcessing();

          startupLogger.info({
            event: "instrumentation.deferred.scheduler.complete",
            elapsedMs: getElapsedMs(),
            jobsProcessed: result.jobsProcessed,
            periodicJobsCreated: result.periodicJobsCreated,
          }, "Deferred scheduler processing complete");
        } catch (err) {
          startupLogger.error({
            event: "instrumentation.deferred.error",
            error: err instanceof Error ? err.message : String(err),
          }, "Error during deferred initialization");
        }
      });

    } catch (err) {
      startupLogger.error({
        event: "instrumentation.services.error",
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: getElapsedMs(),
      }, "Error initializing background services");
    }
  }

  // Log when register completes
  const registerDuration = Date.now() - registerStart;
  startupLogger.info({
    event: "instrumentation.register.complete",
    elapsedMs: getElapsedMs(),
    registerDurationMs: registerDuration,
  }, "Instrumentation register completed");
}
