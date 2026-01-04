import { NextResponse } from "next/server";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "health" });

export async function GET() {
  logger.debug({ event: "health.check" }, "Health check called");
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
