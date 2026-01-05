/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for initializing background services like the job scheduler
 * and file checker.
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

      // Start job queue scheduler
      startupLogger.info({
        event: "instrumentation.scheduler.starting",
        elapsedMs: getElapsedMs(),
      }, "Starting job queue scheduler");

      const { getGlobalScheduler } = await import("@/server/jobs/scheduler");
      const scheduler = getGlobalScheduler({
        intervalMs: 60 * 1000, // Check every 60 seconds
        runOnStart: true,
      });
      scheduler.start();

      startupLogger.info({
        event: "instrumentation.scheduler.started",
        elapsedMs: getElapsedMs(),
      }, "Job queue scheduler started");

      // Start file checker
      startupLogger.info({
        event: "instrumentation.file-checker.starting",
        elapsedMs: getElapsedMs(),
      }, "Starting file checker");

      const { getGlobalFileChecker } = await import("@/server/file-checker");
      const fileChecker = getGlobalFileChecker({
        intervalMs: 10 * 1000, // Check every 10 seconds for new files (configurable via settings)
        runOnStart: true,
      });
      fileChecker.start();

      startupLogger.info({
        event: "instrumentation.file-checker.started",
        elapsedMs: getElapsedMs(),
      }, "File checker started");

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
