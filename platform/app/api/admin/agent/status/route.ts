import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { agentSuggestion } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/** Tells the panel whether the agent is configured (and which model). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Dashboard AI operator status");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    configured: !!process.env.FANZIA_AGENT_API_KEY,
    model: process.env.FANZIA_AGENT_MODEL?.trim() || "llama-3.3-70b-versatile",
  });
}
