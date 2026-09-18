import { NextRequest, NextResponse } from "next/server";
import { decideApplication, NotFoundError, AlreadyDecidedError, type ApplicationDecision } from "@/lib/applications/decide";
import { composeDecisionReason, isValidReasonCode } from "@/lib/applications/decisionReasons";
import { requireActor } from "@/lib/auth/actor";

const VALID_DECISIONS = new Set<ApplicationDecision>(["approved", "declined", "needs_review"]);

/**
 * Approve/decline/needs-review live on one endpoint because they're the
 * same admin action (a queue decision), but approve/decline are restricted
 * for an ai_operator actor and needs_review is not — the branching lives
 * inside lib/applications/decide.ts via performOrPropose, not here.
 *
 * The UI sends `reasonCode` (a code from lib/applications/decisionReasons.ts
 * for the given decision) plus an optional `reasonNote`. A legacy free-text
 * `reason` is still accepted for API callers, but `reasonCode` wins when both
 * are present.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  const decision = json?.decision;
  if (typeof decision !== "string" || !VALID_DECISIONS.has(decision as ApplicationDecision)) {
    return NextResponse.json({ error: "decision must be one of approved, declined, needs_review" }, { status: 400 });
  }
  const typedDecision = decision as ApplicationDecision;

  let reason: string | undefined;
  const reasonCode = json?.reasonCode;
  if (typeof reasonCode === "string" && reasonCode) {
    if (!isValidReasonCode(typedDecision, reasonCode)) {
      return NextResponse.json(
        { error: `reasonCode "${reasonCode}" is not valid for decision "${typedDecision}"` },
        { status: 400 },
      );
    }
    const reasonNote = typeof json?.reasonNote === "string" ? json.reasonNote : undefined;
    try {
      reason = composeDecisionReason(typedDecision, reasonCode, reasonNote);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  } else if (typeof json?.reason === "string" && json.reason.trim()) {
    reason = json.reason.trim();
  }

  try {
    const outcome = await decideApplication({
      applicationId: params.id,
      decision: typedDecision,
      reason,
      actor,
    });
    if (!outcome.executed) {
      return NextResponse.json({ ok: true, proposed: true, proposalId: outcome.proposalId });
    }
    return NextResponse.json({ ok: true, proposed: false, application: outcome.result });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof AlreadyDecidedError)
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    throw err;
  }
}
