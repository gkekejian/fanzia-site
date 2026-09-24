import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { publicHealth } from "@/lib/ops/health";

/**
 * Public uptime endpoint for a free external monitor (UptimeRobot,
 * Better Stack, etc.). 200 {ok:true} when the database answers and the
 * daily ops run has reported in within 26 hours; 503 otherwise, so the
 * monitor emails/texts you. That is the dead-man's switch for "the
 * scheduled jobs silently stopped". No details are exposed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { ok } = await publicHealth(db);
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
