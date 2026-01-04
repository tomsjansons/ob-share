import { NextResponse } from "next/server";
import { logger as baseLogger, getElapsedMs } from "@/lib/logger";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";

const logger = baseLogger.child({ module: "health" });

export async function GET() {
  const startTime = Date.now();
  logger.info({ event: "health.check.start", elapsedMs: getElapsedMs() }, "Health check started");

  try {
    // Test database connectivity with a simple query
    logger.info({ event: "health.db.query.start", elapsedMs: getElapsedMs() }, "Testing database connectivity");
    const result = db.get<{ test: number }>(sql`SELECT 1 as test`);
    const dbTime = Date.now() - startTime;
    logger.info({ event: "health.db.query.success", durationMs: dbTime, elapsedMs: getElapsedMs(), result }, "Database query successful");

    const totalTime = Date.now() - startTime;
    logger.info({ event: "health.check.success", durationMs: totalTime, elapsedMs: getElapsedMs() }, "Health check passed");

    return NextResponse.json({
      status: "ok",
      db: "connected",
      durationMs: totalTime
    }, { status: 200 });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error({
      event: "health.check.error",
      error: error instanceof Error ? error.message : String(error),
      durationMs: totalTime,
      elapsedMs: getElapsedMs()
    }, "Health check failed");

    return NextResponse.json({
      status: "error",
      db: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: totalTime
    }, { status: 503 });
  }
}
