import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { application } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";

/**
 * Read access is not a restricted action — both owner sessions and
 * ai_operator API keys can list the review queue directly (build prompt
 * §14.1: ai_operator has full read access). Sorted by triage score only;
 * the score never decides anything, it just orders the queue (build
 * prompt §8, lib/applications/triage.ts).
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const rows = await db.select().from(application).orderBy(desc(application.triageScore), desc(application.submittedAt));
  return NextResponse.json({ applications: rows });
}
