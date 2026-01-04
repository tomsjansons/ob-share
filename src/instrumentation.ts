/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for debugging startup sequence issues.
 */

export async function register() {
  // Dynamic import to avoid issues during build
  const { logger } = await import("@/lib/logger");
  const startupLogger = logger.child({ module: "startup" });

  startupLogger.info({
    event: "instrumentation.register",
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    nextRuntime: process.env.NEXT_RUNTIME,
  }, "Next.js instrumentation register called");
}
