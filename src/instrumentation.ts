/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for debugging startup sequence issues.
 */

export async function register() {
  console.log("[STARTUP] Instrumentation register() called at", new Date().toISOString());
  console.log("[STARTUP] NODE_ENV:", process.env.NODE_ENV);
  console.log("[STARTUP] DATABASE_URL:", process.env.DATABASE_URL);
  console.log("[STARTUP] NEXT_RUNTIME:", process.env.NEXT_RUNTIME);
  console.log("[STARTUP] Instrumentation complete");
}
