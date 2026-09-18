import { inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { nayaxSale, nayaxSaleSource, nayaxMachine, slotMap } from "@/db/schema/nayax";
import { product } from "@/db/schema/catalog";
import type { LynxLastSale } from "./client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type NormalizedSale = {
  nayaxTxnId: string;
  slotPosition: number | null;
  productId: string | null;
  units: number;
  amountCents: number | null;
  soldAt: Date;
  rawProductName: string | null;
};

export type QuarantinedSale = NormalizedSale & {
  reason: string;
};

/**
 * Resolve a Lynx sale row to a platform product through the slot
 * planogram, in order:
 *  1. Explicit slot position on the row (CSV imports carry it) → slotMap.
 *  2. ProductName string → match against the machine's mapped products
 *     (SKU exact, then product name, case-insensitive).
 * Rows matching nothing are returned on the quarantine list — never
 * silently dropped, never guessed into the wrong product.
 */
async function resolveProduct(
  db: AnyDb,
  machineUuid: string,
  slotPosition: number | null,
  productName: string | null,
): Promise<{ productId: string | null; slotPosition: number | null }> {
  const maps = await db
    .select({
      slotPosition: slotMap.slotPosition,
      productId: slotMap.productId,
      sku: product.sku,
      name: product.name,
    })
    .from(slotMap)
    .innerJoin(product, eq(slotMap.productId, product.id))
    .where(and(eq(slotMap.machineId, machineUuid), eq(slotMap.active, true)));

  if (maps.length === 0) return { productId: null, slotPosition };

  if (slotPosition != null) {
    const hit = maps.find((m) => m.slotPosition === slotPosition);
    if (hit) return { productId: hit.productId, slotPosition };
    return { productId: null, slotPosition };
  }

  const needle = (productName ?? "").trim().toLowerCase();
  if (!needle) return { productId: null, slotPosition };
  const bySku = maps.find((m) => m.sku.toLowerCase() === needle);
  if (bySku) return { productId: bySku.productId, slotPosition: bySku.slotPosition };
  const byName = maps.find((m) => m.name.toLowerCase() === needle);
  if (byName) return { productId: byName.productId, slotPosition: byName.slotPosition };
  return { productId: null, slotPosition };
}

function toNormalized(row: LynxLastSale, slotPosition: number | null): NormalizedSale | null {
  if (row.TransactionID == null || String(row.TransactionID).trim() === "") return null;
  const soldAtRaw =
    row.AuthorizationDateTimeGMT ?? row.MachineAuthorizationTime ?? row.SettlementDateTimeGMT;
  const soldAt = soldAtRaw ? new Date(String(soldAtRaw)) : null;
  if (!soldAt || Number.isNaN(soldAt.getTime())) return null;
  const units = Number(row.Quantity ?? 1);
  const auth = row.AuthorizationValue != null ? Number(row.AuthorizationValue) : null;
  const settle = row.SettlementValue != null ? Number(row.SettlementValue) : null;
  return {
    nayaxTxnId: String(row.TransactionID),
    slotPosition,
    productId: null,
    units: Number.isFinite(units) && units > 0 ? Math.floor(units) : 1,
    // Lynx reports AuthorizationValue/SettlementValue in minor units; the
    // amount is informational for the suggestion engine (quantities drive
    // reorders), so prefer authorization, fall back to settlement.
    amountCents: auth ?? settle ?? null,
    soldAt,
    rawProductName: row.ProductName != null ? String(row.ProductName) : null,
  };
}

export type IngestResult = {
  inserted: number;
  skipped: number;
  quarantined: QuarantinedSale[];
};

/**
 * Normalize + idempotent-upsert one batch of lastSales rows for a machine.
 * Idempotency key is nayax_txn_id: rows already present are skipped (counted
 * as `skipped`), so overlapping polls and CSV/API double-feeds never
 * double-count a sale. Unresolvable rows land on `quarantined` for owner
 * review — the planogram gap they reveal is a setup task, not silent data
 * loss.
 */
export async function ingestSales(
  db: AnyDb,
  machineUuid: string,
  rows: LynxLastSale[],
  source: (typeof nayaxSaleSource.enumValues)[number],
  rowSlotPosition?: (row: LynxLastSale) => number | null,
): Promise<IngestResult> {
  const normalized: NormalizedSale[] = [];
  const quarantined: QuarantinedSale[] = [];

  for (const row of rows) {
    const slot = rowSlotPosition ? rowSlotPosition(row) : null;
    const n = toNormalized(row, slot);
    if (!n) {
      quarantined.push({
        nayaxTxnId: String(row.TransactionID ?? "unknown"),
        slotPosition: slot,
        productId: null,
        units: 1,
        amountCents: null,
        soldAt: new Date(0),
        rawProductName: row.ProductName != null ? String(row.ProductName) : null,
        reason: "missing-or-invalid transaction id / timestamp",
      });
      continue;
    }
    const { productId, slotPosition } = await resolveProduct(
      db,
      machineUuid,
      n.slotPosition,
      n.rawProductName,
    );
    if (!productId) {
      quarantined.push({
        ...n,
        slotPosition,
        reason: "no slot_map entry matches this sale (planogram gap)",
      });
      continue;
    }
    normalized.push({ ...n, productId, slotPosition });
  }

  if (normalized.length === 0) return { inserted: 0, skipped: 0, quarantined };

  const existing = await db
    .select({ nayaxTxnId: nayaxSale.nayaxTxnId })
    .from(nayaxSale)
    .where(inArray(nayaxSale.nayaxTxnId, normalized.map((n) => n.nayaxTxnId)));
  const seen = new Set(existing.map((r) => r.nayaxTxnId));

  const fresh = normalized.filter((n) => !seen.has(n.nayaxTxnId));
  const skipped = normalized.length - fresh.length;

  if (fresh.length > 0) {
    await db.insert(nayaxSale).values(
      fresh.map((n) => ({
        machineId: machineUuid,
        slotPosition: n.slotPosition,
        productId: n.productId,
        units: n.units,
        amountCents: n.amountCents,
        soldAt: n.soldAt,
        nayaxTxnId: n.nayaxTxnId,
        source,
      })),
    );
  }

  return { inserted: fresh.length, skipped, quarantined };
}

/** Convenience wrapper used by the CSV import route (source='csv'). */
export async function ingestCsvRows(
  db: AnyDb,
  machineUuid: string,
  rows: LynxLastSale[],
): Promise<IngestResult> {
  return ingestSales(db, machineUuid, rows, "csv", (row) => {
    const slot = (row as Record<string, unknown>).slot_position ?? (row as Record<string, unknown>).SlotPosition;
    const n = Number(slot);
    return Number.isFinite(n) ? Math.floor(n) : null;
  });
}

export async function findMachineByNayaxId(
  db: AnyDb,
  nayaxMachineId: number,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: nayaxMachine.id, name: nayaxMachine.name })
    .from(nayaxMachine)
    .where(eq(nayaxMachine.nayaxMachineId, nayaxMachineId))
    .limit(1);
  return rows[0] ?? null;
}

export { defaultDb };
