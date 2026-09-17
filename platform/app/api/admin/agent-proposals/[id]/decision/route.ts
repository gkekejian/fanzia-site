import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProposal } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { executeApprovedProposal } from "@/lib/auth/proposalExecution";
import { recordAudit } from "@/lib/audit";

/**
 * Only an owner may decide a pending agent_proposal (build prompt §14: "a
 * human owner decision... is recorded with actor and timestamp") — an
 * ai_operator can never approve its own proposal, so this is a hard
 * assertOwner, not a performOrPropose call. Approving re-runs the original
 * action through the same service function the direct admin UI uses
 * (lib/auth/proposalExecution.ts), attributed to the deciding owner.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Deciding an agent proposal");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const decision = json?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(agentProposal)
    .where(and(eq(agentProposal.id, params.id), eq(agentProposal.decision, "pending")))
    .limit(1);
  const proposal = rows[0];
  if (!proposal) return NextResponse.json({ error: "Not found or already decided" }, { status: 404 });

  if (decision === "rejected") {
    await db
      .update(agentProposal)
      .set({ decision: "rejected", decidedBy: actor.user.id, decidedAt: new Date() })
      .where(eq(agentProposal.id, proposal.id));
    await recordAudit({
      actorUserId: actor.user.id,
      actorRole: "owner",
      actorType: "owner",
      action: "agent_proposal.rejected",
      entityType: "agent_proposal",
      entityId: proposal.id,
    });
    return NextResponse.json({ ok: true, decision: "rejected" });
  }

  let executionResult;
  try {
    executionResult = await executeApprovedProposal(
      { proposedAction: proposal.proposedAction, payload: proposal.payload as Record<string, unknown> },
      actor.user,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    return NextResponse.json({ error: `Approved but could not execute: ${message}` }, { status: 400 });
  }

  await db
    .update(agentProposal)
    .set({ decision: "approved", decidedBy: actor.user.id, decidedAt: new Date() })
    .where(eq(agentProposal.id, proposal.id));
  await recordAudit({
    actorUserId: actor.user.id,
    actorRole: "owner",
    actorType: "owner",
    action: "agent_proposal.approved",
    entityType: "agent_proposal",
    entityId: proposal.id,
    after: { proposedAction: proposal.proposedAction },
  });

  return NextResponse.json({ ok: true, decision: "approved", result: executionResult });
}
