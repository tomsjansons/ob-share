/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for debugging startup sequence issues.
 */

export async function register() {
  console.log("[STARTUP] Instrumentation register() called");
  console.log("[STARTUP] NODE_ENV:", process.env.NODE_ENV);
  console.log("[STARTUP] DATABASE_URL:", process.env.DATABASE_URL);

  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[STARTUP] Running in Node.js runtime");

    try {
      console.log("[STARTUP] Attempting to import database module...");
      const { db } = await import("@/server/db");
      console.log("[STARTUP] Database module imported successfully");

      // Try a simple query to verify connection
      console.log("[STARTUP] Testing database connection...");
      const result = await db.run(
        // @ts-expect-error - raw SQL for testing
        { sql: "SELECT 1 as test", params: [] }
      ).catch(() => null);
      console.log("[STARTUP] Database connection test result:", result);
    } catch (error) {
      console.error("[STARTUP] Error during database initialization:", error);
    }

    console.log("[STARTUP] Instrumentation complete");
  }
}
