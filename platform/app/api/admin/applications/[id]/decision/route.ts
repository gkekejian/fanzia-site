import { NextRequest, NextResponse } from "next/server";
import { decideApplication, NotFoundError, type ApplicationDecision } from "@/lib/applications/decide";
import { requireActor } from "@/lib/auth/actor";

const VALID_DECISIONS = new Set<ApplicationDecision>(["approved", "declined", "needs_review"]);

/**
 * Approve/decline/needs-review live on one endpoint because they're the
 * same admin action (a queue decision), but approve/decline are restricted
 * for an ai_operator actor and needs_review is not — the branching lives
 * inside lib/applications/decide.ts via performOrPropose, not here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  const decision = json?.decision;
  if (typeof decision !== "string" || !VALID_DECISIONS.has(decision as ApplicationDecision)) {
    return NextResponse.json({ error: "decision must be one of approved, declined, needs_review" }, { status: 400 });
  }
  const reason = typeof json?.reason === "string" ? json.reason : undefined;

  try {
    const outcome = await decideApplication({
      applicationId: params.id,
      decision: decision as ApplicationDecision,
      reason,
      actor,
    });
    if (!outcome.executed) {
      return NextResponse.json({ ok: true, proposed: true, proposalId: outcome.proposalId });
    }
    return NextResponse.json({ ok: true, proposed: false, application: outcome.result });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
