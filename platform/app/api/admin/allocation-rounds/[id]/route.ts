import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, product, supplier } from "@/db/schema";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

/**
 * Owner-only. The full line table (every buyer's rows) is returned here —
 * this is exactly why this endpoint is gated to owners. No buyer-facing
 * endpoint may ever join allocation_line across accounts.
 */
async function requireOwner(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return { error: actor };
  try {
    assertOwner(actor, "Viewing an allocation round");
  } catch {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { actor };
}

async function getRound(id: string) {
  const [round] = await db.select().from(allocationRound).where(eq(allocationRound.id, id)).limit(1);
  return round ?? null;
}

/** Forward-only lifecycle; same-status writes are no-ops. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  collecting: ["allocating", "closed"],
  allocating: ["closed"],
  closed: ["ordered"],
  ordered: [],
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireOwner(req);
  if (gate.error) return gate.error;

  const round = await getRound(params.id);
  if (!round) return NextResponse.json({ error: "Allocation round not found." }, { status: 404 });

  const [sup] = await db.select({ name: supplier.name }).from(supplier).where(eq(supplier.id, round.supplierId)).limit(1);

  const lines = await db
    .select({
      id: allocationLine.id,
      accountId: allocationLine.accountId,
      accountName: account.legalName,
      productId: allocationLine.productId,
      productSku: product.sku,
      productName: product.name,
      requestedQty: allocationLine.requestedQty,
      allocatedQty: allocationLine.allocatedQty,
      status: allocationLine.status,
      notes: allocationLine.notes,
    })
    .from(allocationLine)
    .innerJoin(account, eq(allocationLine.accountId, account.id))
    .innerJoin(product, eq(allocationLine.productId, product.id))
    .where(eq(allocationLine.roundId, round.id));

  // Per-product summary from stored quantities (post-allocate / post-adjust).
  const summaryByProduct: Record<
    string,
    { requested: number; allocated: number; shortfallByAccount: Record<string, number> }
  > = {};
  for (const l of lines) {
    const s = (summaryByProduct[l.productId] ??= { requested: 0, allocated: 0, shortfallByAccount: {} });
    s.requested += l.requestedQty;
    s.allocated += l.allocatedQty;
    const short = l.requestedQty - l.allocatedQty;
    if (short > 0) s.shortfallByAccount[l.accountId] = (s.shortfallByAccount[l.accountId] ?? 0) + short;
  }

  return NextResponse.json({
    allocationRound: { ...round, supplierName: sup?.name ?? null },
    lines,
    summaryByProduct,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireOwner(req);
  if (gate.error) return gate.error;
  const ownerId = actorUserId(gate.actor);

  const round = await getRound(params.id);
  if (!round) return NextResponse.json({ error: "Allocation round not found." }, { status: 404 });

  const json = await req.json().catch(() => null);
  const before = { status: round.status, cutoffAt: round.cutoffAt };

  const updates: { cutoffAt?: Date | null; status?: typeof round.status } = {};

  if (json?.cutoffAt !== undefined) {
    if (json.cutoffAt === null) {
      updates.cutoffAt = null;
    } else {
      const parsed = new Date(json.cutoffAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "cutoffAt is not a valid date." }, { status: 400 });
      }
      updates.cutoffAt = parsed;
    }
  }

  if (json?.status !== undefined) {
    const next = String(json.status);
    if (next !== round.status) {
      const allowed = ALLOWED_TRANSITIONS[round.status] ?? [];
      if (!allowed.includes(next)) {
        return NextResponse.json(
          { error: `Cannot move a round from '${round.status}' to '${next}'.` },
          { status: 400 },
        );
      }
      updates.status = next as typeof round.status;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, allocationRound: round });
  }

  const [updated] = await db
    .update(allocationRound)
    .set({
      ...updates,
      ...(updates.status === "closed" ? { closedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(allocationRound.id, round.id))
    .returning();
  if (!updated) throw new Error("Failed to update the allocation round.");

  if (updates.status === "closed") {
    // Manual close freezes whatever lines hold today; the allocate +
    // approve endpoints are the normal path to a closed round.
    await db.update(allocationLine).set({ status: "closed" }).where(eq(allocationLine.roundId, round.id));
  }

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "allocation_round.updated",
    entityType: "allocation_round",
    entityId: round.id,
    before,
    after: { status: updated.status, cutoffAt: updated.cutoffAt },
  });

  return NextResponse.json({ ok: true, allocationRound: updated });
}
