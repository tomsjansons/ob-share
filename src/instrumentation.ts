/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for debugging startup sequence issues.
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

  // Log when register completes
  const registerDuration = Date.now() - registerStart;
  startupLogger.info({
    event: "instrumentation.register.complete",
    elapsedMs: getElapsedMs(),
    registerDurationMs: registerDuration,
  }, "Instrumentation register completed");
}
