import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { generateAgentSuggestions } from "@/lib/agent/suggestions";

/**
 * Daily suggestion generator for the dashboard AI operator. Runs on Vercel
 * Cron (vercel.json) with the same CRON_SECRET bearer check as the other
 * cron routes. Rule-based only (no LLM): margin alerts, restock ideas, a
 * "what's hot / what's new" market brief, and ops nudges — written to
 * agent_suggestion, surfaced by the chat panel.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  try {
    const { inserted, byKind } = await generateAgentSuggestions(db, now);
    await recordAudit({
      actorType: "system",
      action: "agent_suggestions.generated",
      entityType: "agent_suggestion",
      after: { inserted, byKind },
    });
    return NextResponse.json({ ok: true, inserted, byKind });
  } catch (error) {
    await recordAudit({
      actorType: "system",
      action: "agent_suggestions.failed",
      entityType: "agent_suggestion",
      after: { error: String(error).slice(0, 500) },
    });
    return NextResponse.json({ error: "Suggestion run failed" }, { status: 500 });
  }
}
