import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

/**
 * Owner-only. Approves the proposed split and closes the round.
 *
 * Optional body: { adjustments: [{ lineId, allocatedQty, reason }] } —
 * last-minute quantity changes the owner makes on the review screen. Each
 * adjustment is audit-logged with its reason; a missing/empty reason
 * rejects the adjustment. Closing a round does NOT generate invoices yet
 * (later phase); buyer rules ($500 min / $5k cap / $25 fee / 48h expiry)
 * live in the order-request/invoicing flow and are untouched here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Approving an allocation round");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ownerId = actorUserId(actor);

  const [round] = await db.select().from(allocationRound).where(eq(allocationRound.id, params.id)).limit(1);
  if (!round) return NextResponse.json({ error: "Allocation round not found." }, { status: 404 });
  if (round.status !== "allocating") {
    return NextResponse.json(
      { error: `Only an 'allocating' round can be approved (this one is '${round.status}').` },
      { status: 400 },
    );
  }

  const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round.id));
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const json = await req.json().catch(() => ({}));
  const adjustments = Array.isArray(json?.adjustments) ? json.adjustments : [];
  for (const adj of adjustments) {
    const lineId = typeof adj?.lineId === "string" ? adj.lineId : "";
    const qty = Math.floor(Number(adj?.allocatedQty));
    const reason = typeof adj?.reason === "string" ? adj.reason.trim() : "";
    const line = lineById.get(lineId);
    if (!line) {
      return NextResponse.json({ error: `Adjustment references unknown line: ${lineId}.` }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json({ error: `Adjustment for line ${lineId} needs a non-negative allocatedQty.` }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: `Adjustment for line ${lineId} needs a reason.` }, { status: 400 });
    }
    if (qty !== line.allocatedQty) {
      await db.update(allocationLine).set({ allocatedQty: qty }).where(eq(allocationLine.id, lineId));
      await recordAudit({
        actorUserId: ownerId,
        actorRole: "owner",
        actorType: "owner",
        action: "allocation_line.adjusted",
        entityType: "allocation_line",
        entityId: lineId,
        before: { allocatedQty: line.allocatedQty },
        after: { allocatedQty: qty, reason },
      });
      line.allocatedQty = qty;
    }
  }

  const [closed] = await db
    .update(allocationRound)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(allocationRound.id, round.id))
    .returning();
  await db.update(allocationLine).set({ status: "closed" }).where(eq(allocationLine.roundId, round.id));

  const finalSplit = lines.map((l) => ({
    lineId: l.id,
    accountId: l.accountId,
    productId: l.productId,
    requestedQty: l.requestedQty,
    allocatedQty: l.allocatedQty,
  }));

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "allocation_round.closed",
    entityType: "allocation_round",
    entityId: round.id,
    after: { adjustmentCount: adjustments.length, finalSplit },
  });

  return NextResponse.json({ ok: true, allocationRound: closed, lines: finalSplit });
}
