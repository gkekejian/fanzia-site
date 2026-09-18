import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
// Direct module import (not the barrel) until the schema coordinator wires
// 0019's tables into db/schema/index.ts.
import { poPack } from "@/db/schema/distributor";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

/**
 * POST /api/admin/allocation-rounds/[id]/mark-ordered — owner-only.
 *
 * Records that a human owner placed the round's distributor order(s) by
 * hand through the distributor's own channel, with the distributor's
 * confirmation number(s). This is bookkeeping ONLY:
 *
 *   THE PLATFORM NEVER AUTO-SUBMITS A PURCHASE ORDER TO ANY DISTRIBUTOR.
 *   Not now, not in v2 of this endpoint. George/Joe place every order
 *   through each distributor's own portal/channel; this endpoint just
 *   closes the loop in our own records.
 *
 * Body: { confirmationNumbers: string[], supplierId?: string }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Marking an allocation round ordered");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const confirmationNumbers = Array.isArray(json?.confirmationNumbers)
    ? (json.confirmationNumbers as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const supplierId =
    typeof json?.supplierId === "string" && json.supplierId ? json.supplierId : null;

  if (confirmationNumbers.length === 0) {
    return NextResponse.json({ error: "At least one confirmation number is required" }, { status: 400 });
  }

  const where = supplierId
    ? and(eq(poPack.roundId, params.id), eq(poPack.supplierId, supplierId))
    : eq(poPack.roundId, params.id);

  const packs = await db.select().from(poPack).where(where);
  if (packs.length === 0) {
    return NextResponse.json(
      { error: "No PO pack found for this round — generate one before marking ordered." },
      { status: 404 },
    );
  }

  const actorType = actor.kind === "owner" ? "owner" : "ai_operator";
  for (const pack of packs) {
    await db
      .update(poPack)
      .set({ status: "ordered", orderedAt: new Date(), confirmationNumbers })
      .where(eq(poPack.id, pack.id));
    await recordAudit({
      actorUserId: actor.user.id,
      actorRole: actor.kind === "owner" ? "owner" : null,
      actorType,
      action: "allocation_round.marked_ordered",
      entityType: "po_pack",
      entityId: pack.id,
      before: { status: pack.status },
      after: {
        status: "ordered",
        roundId: pack.roundId,
        roundRef: pack.roundRef,
        supplierId: pack.supplierId,
        confirmationNumbers,
        note: "Owner-placed by hand through the distributor's own channel. No auto-submission.",
      },
    });
  }

  return NextResponse.json({ ok: true, markedOrdered: packs.length, confirmationNumbers });
}
