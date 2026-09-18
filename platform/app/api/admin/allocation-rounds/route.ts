import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, product, supplier } from "@/db/schema";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { notifyOwnersEvent } from "@/lib/notifications";
import { ALLOCATION_POLICY_OPTIONS, ALLOCATION_POLICY_SNAPSHOT } from "@/lib/allocation/engine";

/**
 * Owner-only. No buyer-facing endpoint ever serves allocation_round /
 * allocation_line rows — external buyers only ever see their own approved
 * allocation and invoice through the order-request flow, as today.
 */
async function requireOwner(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return { error: actor };
  try {
    assertOwner(actor, "Managing allocation rounds");
  } catch {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { actor };
}

export async function GET(req: NextRequest) {
  const gate = await requireOwner(req);
  if (gate.error) return gate.error;

  const rows = await db
    .select({
      id: allocationRound.id,
      name: allocationRound.name,
      supplierName: supplier.name,
      status: allocationRound.status,
      cutoffAt: allocationRound.cutoffAt,
      createdAt: allocationRound.createdAt,
    })
    .from(allocationRound)
    .innerJoin(supplier, eq(allocationRound.supplierId, supplier.id))
    .orderBy(desc(allocationRound.createdAt))
    .limit(200);

  const lineCounts = await db
    .select({ roundId: allocationLine.roundId })
    .from(allocationLine);
  const countByRound = new Map<string, number>();
  for (const r of lineCounts) countByRound.set(r.roundId, (countByRound.get(r.roundId) ?? 0) + 1);

  return NextResponse.json({
    allocationRounds: rows.map((r) => ({ ...r, lineCount: countByRound.get(r.id) ?? 0 })),
  });
}

type CreateLineInput = {
  accountId?: unknown;
  productId?: unknown;
  requestedQty?: unknown;
  notes?: unknown;
};

/**
 * Setting key holding the default internal (Fanzia) buyer account id, set
 * once by an owner. Used when POST create omits internalAccountId.
 */
const INTERNAL_ACCOUNT_SETTING_KEY = "allocation_internal_account_id";

export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (gate.error) return gate.error;
  const ownerId = actorUserId(gate.actor);

  const json = await req.json().catch(() => null);
  const name = typeof json?.name === "string" ? json.name.trim() : "";
  const supplierId = typeof json?.supplierId === "string" ? json.supplierId : "";
  const policy = typeof json?.policy === "string" ? json.policy : "";
  if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
  if (!supplierId) return NextResponse.json({ error: "supplierId is required." }, { status: 400 });
  const policyOption = ALLOCATION_POLICY_OPTIONS.find((o) => o.mode === policy);
  if (!policyOption) {
    return NextResponse.json(
      { error: `policy must be one of: ${ALLOCATION_POLICY_OPTIONS.map((o) => o.mode).join(", ")}.` },
      { status: 400 },
    );
  }

  const [sup] = await db.select({ id: supplier.id }).from(supplier).where(eq(supplier.id, supplierId)).limit(1);
  if (!sup) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });

  let internalAccountId: string | null =
    typeof json?.internalAccountId === "string" && json.internalAccountId ? json.internalAccountId : null;
  if (!internalAccountId) {
    internalAccountId = await getSetting<string | null>(INTERNAL_ACCOUNT_SETTING_KEY, null);
  }
  if (internalAccountId) {
    const [acct] = await db.select({ id: account.id }).from(account).where(eq(account.id, internalAccountId)).limit(1);
    if (!acct) return NextResponse.json({ error: "Internal account not found." }, { status: 404 });
  }

  let cutoffAt: Date | null = null;
  if (json?.cutoffAt) {
    const parsed = new Date(json.cutoffAt);
    if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "cutoffAt is not a valid date." }, { status: 400 });
    cutoffAt = parsed;
  }

  const rawLines: CreateLineInput[] = Array.isArray(json?.lines) ? json.lines : [];
  const lineInputs: { accountId: string; productId: string; requestedQty: number; notes: string | null }[] = [];
  for (const raw of rawLines) {
    const accountId = typeof raw.accountId === "string" ? raw.accountId : "";
    const productId = typeof raw.productId === "string" ? raw.productId : "";
    const requestedQty = Math.floor(Number(raw.requestedQty));
    if (!accountId || !productId || !Number.isFinite(requestedQty) || requestedQty < 0) {
      return NextResponse.json(
        { error: "Each line needs accountId, productId, and a non-negative requestedQty." },
        { status: 400 },
      );
    }
    const [a] = await db.select({ id: account.id }).from(account).where(eq(account.id, accountId)).limit(1);
    if (!a) return NextResponse.json({ error: `Account not found: ${accountId}.` }, { status: 404 });
    const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, productId)).limit(1);
    if (!p) return NextResponse.json({ error: `Product not found: ${productId}.` }, { status: 404 });
    lineInputs.push({
      accountId,
      productId,
      requestedQty,
      notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null,
    });
  }

  // The policy snapshot is immutable from this moment — the engine and the
  // review UI both read it from the round, never from a live config.
  const policySnapshot = { ...ALLOCATION_POLICY_SNAPSHOT };
  const [round] = await db
    .insert(allocationRound)
    .values({
      name,
      supplierId,
      internalAccountId,
      cutoffAt,
      policySnapshot,
      createdBy: ownerId,
    })
    .returning();
  if (!round) throw new Error("Failed to create the allocation round.");

  if (lineInputs.length > 0) {
    await db.insert(allocationLine).values(
      lineInputs.map((l) => ({
        roundId: round.id,
        accountId: l.accountId,
        productId: l.productId,
        requestedQty: l.requestedQty,
        notes: l.notes,
      })),
    );
  }

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "allocation_round.created",
    entityType: "allocation_round",
    entityId: round.id,
    after: { name, supplierId, policy: policySnapshot, lineCount: lineInputs.length },
  });

  // Allocation rounds are owner-created, but both owners still get the
  // in-app + email record so either of them can pick up the review.
  await notifyOwnersEvent(
    {
      type: "allocation_requested",
      title: `Allocation round created — ${name}`,
      body:
        `A new allocation round "${name}" was created with ${lineInputs.length} ` +
        `request line${lineInputs.length === 1 ? "" : "s"} ` +
        `(policy: ${policySnapshot.mode}). Review and run it from the allocation console.`,
      entityType: "allocation_round",
      entityId: round.id,
    },
    db,
  );

  return NextResponse.json({ ok: true, allocationRound: round }, { status: 201 });
}
