import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { allocateRound } from "@/lib/allocation/engine";

/**
 * Owner-only. Runs the fanzia_first allocation engine over the round's
 * lines and stores per-line allocatedQty. Re-running replaces the previous
 * proposed split (still pre-approval — nothing buyer-facing reads these
 * rows until the round is closed).
 *
 * Body: { availableByProduct: { [productId]: units }, caseSizes?: { [productId]: unitsPerCase } }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Running allocation");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ownerId = actorUserId(actor);

  const [round] = await db.select().from(allocationRound).where(eq(allocationRound.id, params.id)).limit(1);
  if (!round) return NextResponse.json({ error: "Allocation round not found." }, { status: 404 });
  if (round.status === "closed" || round.status === "ordered") {
    return NextResponse.json({ error: `Cannot allocate a ${round.status} round.` }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const rawAvail = json?.availableByProduct;
  if (!rawAvail || typeof rawAvail !== "object" || Array.isArray(rawAvail)) {
    return NextResponse.json({ error: "availableByProduct is required (object of productId → units)." }, { status: 400 });
  }
  const rawCases = json?.caseSizes;
  if (rawCases !== undefined && (typeof rawCases !== "object" || Array.isArray(rawCases))) {
    return NextResponse.json({ error: "caseSizes must be an object of productId → units per case." }, { status: 400 });
  }

  const availableByProduct: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawAvail as Record<string, unknown>)) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `availableByProduct[${k}] must be a non-negative number.` }, { status: 400 });
    }
    availableByProduct[k] = n;
  }
  const caseSizes: Record<string, number> = {};
  for (const [k, v] of Object.entries((rawCases ?? {}) as Record<string, unknown>)) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: `caseSizes[${k}] must be a positive integer.` }, { status: 400 });
    }
    caseSizes[k] = n;
  }

  const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round.id));
  if (lines.length === 0) {
    return NextResponse.json({ error: "No lines in this round — nothing to allocate." }, { status: 400 });
  }

  const result = allocateRound({
    lines: lines.map((l) => ({
      lineId: l.id,
      productId: l.productId,
      accountId: l.accountId,
      requestedQty: l.requestedQty,
    })),
    availableByProduct,
    caseSizes,
    internalAccountId: round.internalAccountId,
  });

  const allocatedByLineId = new Map(result.lines.map((l) => [l.lineId, l.allocatedQty]));
  for (const l of lines) {
    await db
      .update(allocationLine)
      .set({ allocatedQty: allocatedByLineId.get(l.id) ?? 0, status: "allocated" })
      .where(eq(allocationLine.id, l.id));
  }

  const [updated] = await db
    .update(allocationRound)
    .set({ status: "allocating", updatedAt: new Date() })
    .where(eq(allocationRound.id, round.id))
    .returning();

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "allocation_round.allocated",
    entityType: "allocation_round",
    entityId: round.id,
    after: {
      policy: round.policySnapshot,
      lineCount: lines.length,
      summaryByProduct: result.summaryByProduct,
    },
  });

  return NextResponse.json({
    ok: true,
    allocationRound: updated,
    lines: result.lines,
    summaryByProduct: result.summaryByProduct,
  });
}
