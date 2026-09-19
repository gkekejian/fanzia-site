import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { agentSuggestion } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/** Latest proactive suggestions for the chat panel (owner-only). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Dashboard AI operator suggestions");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kind = req.nextUrl.searchParams.get("kind");
  const rows = await db
    .select({
      id: agentSuggestion.id,
      kind: agentSuggestion.kind,
      title: agentSuggestion.title,
      body: agentSuggestion.body,
      createdAt: agentSuggestion.createdAt,
    })
    .from(agentSuggestion)
    .where(kind ? eq(agentSuggestion.kind, kind as "margin_alert" | "restock_idea" | "market_brief" | "ops_nudge") : undefined)
    .orderBy(desc(agentSuggestion.createdAt))
    .limit(20);

  return NextResponse.json({
    suggestions: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    })),
  });
}
