import { NextResponse } from "next/server";
import { logger as baseLogger } from "@/lib/logger";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";

const logger = baseLogger.child({ module: "health" });

export async function GET() {
  const startTime = Date.now();

  try {
    // Test database connectivity with a simple query
    db.get<{ test: number }>(sql`SELECT 1 as test`);
    const durationMs = Date.now() - startTime;

    logger.info({ event: "health.check.ok", durationMs });

    return NextResponse.json(
      {
        status: "ok",
        db: "connected",
        durationMs,
      },
      { status: 200 },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        event: "health.check.error",
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      },
      "Health check failed",
    );

    return NextResponse.json(
      {
        status: "error",
        db: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs,
      },
      { status: 503 },
    );
  }
}
