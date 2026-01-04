import { NextResponse } from "next/server";

export async function GET() {
  console.log("[HEALTH] Health check called at", new Date().toISOString());
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
