import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { supplier } from "@/db/schema/catalog";
// Imported directly from the module (not the barrel) until the schema
// coordinator wires 0019's tables into db/schema/index.ts.
import { distributorSku, poPack } from "@/db/schema/distributor";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { buildPoPack, suggestSupplierFor, type PoPackLineInput } from "@/lib/po/pack";
import { logSupplierOverride } from "@/lib/po/overrides";

type OwnerActor = { kind: "owner"; user: import("@/lib/auth/session").AuthedUser };

async function requireOwner(req: NextRequest): Promise<OwnerActor | NextResponse> {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Managing distributor PO packs");
    return actor;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

/**
 * GET: list generated PO packs (newest first) plus the supplier list for
 * the generation form. Supplier/cost data is owner-only — never exposed
 * on any buyer surface.
 */
export async function GET(req: NextRequest) {
  const actor = await requireOwner(req);
  if (actor instanceof NextResponse) return actor;

  const packs = await db.select().from(poPack).orderBy(desc(poPack.createdAt)).limit(50);
  const suppliers = await db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .orderBy(supplier.name);

  return NextResponse.json({ poPacks: packs, suppliers });
}

/**
 * POST: generate a PO pack for one closed allocation round + one supplier
 * and store it as an artifact. The platform NEVER auto-submits to a
 * distributor — the pack is downloaded and placed by hand.
 *
 * Body: { roundId, roundRef, supplierId, lines[], overrideSupplierId? }
 * Lines are supplied by the allocation-round worker's review screen (the
 * rounds table is a parallel build); overrideSupplierId lets the owner
 * replace the suggested supplier and is audit-logged per line.
 */
export async function POST(req: NextRequest) {
  const actor = await requireOwner(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  const roundId = typeof json?.roundId === "string" ? json.roundId.trim() : "";
  const roundRef = typeof json?.roundRef === "string" ? json.roundRef.trim() : "";
  const supplierId = typeof json?.supplierId === "string" ? json.supplierId : "";
  const overrideSupplierId =
    typeof json?.overrideSupplierId === "string" && json.overrideSupplierId ? json.overrideSupplierId : null;
  const lines = Array.isArray(json?.lines) ? (json.lines as PoPackLineInput[]) : [];

  if (!roundId || !roundRef || !supplierId) {
    return NextResponse.json({ error: "roundId, roundRef, and supplierId are required" }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "lines must contain at least one line item" }, { status: 400 });
  }

  const effectiveSupplierId = overrideSupplierId ?? supplierId;
  const supplierRows = await db.select().from(supplier).where(eq(supplier.id, effectiveSupplierId)).limit(1);
  const effectiveSupplier = supplierRows[0];
  if (!effectiveSupplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Per-line supplier suggestions from the landed-cost engine (falls back
  // to the round's supplier when the engine is unavailable).
  const suggestions = await Promise.all(
    lines.map((l) => suggestSupplierFor(l.productId, l.qtyUnits, supplierId)),
  );

  const mappings = await db
    .select()
    .from(distributorSku)
    .where(eq(distributorSku.supplierId, effectiveSupplierId));

  const pack = buildPoPack({
    round: { id: roundId, ref: roundRef },
    lines,
    distributorSkus: mappings.map((m) => ({
      productId: m.productId,
      distributorSku: m.distributorSku,
      upc: m.upc,
    })),
    supplier: { id: effectiveSupplier.id, name: effectiveSupplier.name, notes: effectiveSupplier.notes },
  });

  const [stored] = await db
    .insert(poPack)
    .values({
      roundId,
      roundRef,
      supplierId: effectiveSupplier.id,
      status: "generated",
      payload: pack,
      createdBy: actor.user.id,
    })
    .returning();
  if (!stored) throw new Error("po_pack insert returned no row");

  const actorType = actor.kind === "owner" ? "owner" : "ai_operator";
  const auditBase = {
    actorUserId: actor.user.id,
    actorRole: actor.kind === "owner" ? "owner" : null,
    actorType,
  } as const;

  await recordAudit({
    ...auditBase,
    action: "po_pack.generated",
    entityType: "po_pack",
    entityId: stored.id,
    after: {
      roundId,
      roundRef,
      supplierId: effectiveSupplier.id,
      supplierName: effectiveSupplier.name,
      lineCount: pack.items.length,
      warningCount: pack.warnings.length,
    },
  });

  if (overrideSupplierId && overrideSupplierId !== supplierId) {
    for (let i = 0; i < lines.length; i++) {
      const suggestion = suggestions[i];
      const line = lines[i];
      if (!suggestion || !line) continue;
      if (suggestion.supplierId !== effectiveSupplierId) {
        await logSupplierOverride({
          actorUserId: actor.user.id,
          actorRole: auditBase.actorRole,
          actorType,
          roundId,
          productId: line.productId,
          suggestedSupplierId: suggestion.supplierId,
          suggestedSource: suggestion.source,
          overrideSupplierId: effectiveSupplierId,
          poPackId: stored.id,
        });
      }
    }
  }

  return NextResponse.json({ id: stored.id, pack }, { status: 201 });
}
