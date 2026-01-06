/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for initializing background services like the job scheduler
 * and file checker.
 *
 * IMPORTANT: We defer the initial runs of background services to avoid
 * blocking the event loop during startup. better-sqlite3 is synchronous
 * and can block the event loop during database operations. If multiple
 * services try to write concurrently, the busy_timeout (30s) can cause
 * the HTTP server to become unresponsive.
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

      // Start job queue scheduler - defer initial run to avoid blocking
      startupLogger.info({
        event: "instrumentation.scheduler.starting",
        elapsedMs: getElapsedMs(),
      }, "Starting job queue scheduler");

      const { getGlobalScheduler } = await import("@/server/jobs/scheduler");
      const scheduler = getGlobalScheduler({
        intervalMs: 60 * 1000, // Check every 60 seconds
        runOnStart: false, // Don't run immediately - defer to avoid blocking
      });
      scheduler.start();

      startupLogger.info({
        event: "instrumentation.scheduler.started",
        elapsedMs: getElapsedMs(),
      }, "Job queue scheduler started");

      // Start file checker - defer initial run to avoid blocking
      startupLogger.info({
        event: "instrumentation.file-checker.starting",
        elapsedMs: getElapsedMs(),
      }, "Starting file checker");

      const { getGlobalFileChecker } = await import("@/server/file-checker");
      const fileChecker = getGlobalFileChecker({
        intervalMs: 10 * 1000, // Check every 10 seconds for new files (configurable via settings)
        runOnStart: false, // Don't run immediately - defer to avoid blocking
      });
      fileChecker.start();

      startupLogger.info({
        event: "instrumentation.file-checker.started",
        elapsedMs: getElapsedMs(),
      }, "File checker started");

      // Defer the initial runs using setImmediate to allow the HTTP server to start first
      // This ensures the event loop is free to handle HTTP requests during startup
      // Stagger the runs to avoid concurrent database operations which can block
      setImmediate(() => {
        startupLogger.info({
          event: "instrumentation.deferred.scheduler",
          elapsedMs: getElapsedMs(),
        }, "Running deferred scheduler processing");

        scheduler.triggerProcessing().then(() => {
          startupLogger.info({
            event: "instrumentation.deferred.scheduler.complete",
            elapsedMs: getElapsedMs(),
          }, "Deferred scheduler processing complete");

          // Only start file checker after scheduler completes to avoid concurrent writes
          startupLogger.info({
            event: "instrumentation.deferred.file-checker",
            elapsedMs: getElapsedMs(),
          }, "Running deferred file checker");

          fileChecker.triggerCheck().then(() => {
            startupLogger.info({
              event: "instrumentation.deferred.file-checker.complete",
              elapsedMs: getElapsedMs(),
            }, "Deferred file checker complete");
          }).catch((err) => {
            startupLogger.error({
              event: "instrumentation.deferred.file-checker.error",
              error: err instanceof Error ? err.message : String(err),
            }, "Error during deferred file checker");
          });
        }).catch((err) => {
          startupLogger.error({
            event: "instrumentation.deferred.scheduler.error",
            error: err instanceof Error ? err.message : String(err),
          }, "Error during deferred scheduler processing");
        });
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
