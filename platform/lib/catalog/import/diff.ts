import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, desc, ilike } from "drizzle-orm";
import { product, sourcingRoute, supplier, priceEpoch, sourceCheck } from "@/db/schema";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { isBelowMarkupFloor } from "../pricingMath";
import { catalogImportRowSchema } from "./rowSchema";
import { defaultMarkupBpsForRouteType } from "../pricingDefaults";
import type { RawImportRow } from "./parse";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type DiffType = "add" | "price_change" | "availability_change" | "msrp_change" | "missing" | "unchanged" | "invalid";

export type ComputedRow = {
  rowNumber: number;
  diffType: DiffType;
  stagedData: Record<string, unknown>;
  validationErrors: string[] | null;
  matchedProductId: string | null;
  included: boolean;
};

/**
 * Build prompt §9: the former 28% "margin floor" becomes a 28% markup floor
 * (`markup_floor_bps`, default 2800), overridable per sourcing route. A
 * proposed price is only ever blocked, never silently raised to the floor —
 * silently changing the proposed price would break the reviewability the
 * whole import pipeline is built on (test gate #15).
 */
export async function effectiveMarkupFloorBps(
  existingRoute: { markupFloorBpsOverride: number | null } | null | undefined,
  db: AnyDb,
): Promise<number> {
  if (existingRoute?.markupFloorBpsOverride != null) return existingRoute.markupFloorBpsOverride;
  return getSetting<number>(SETTINGS_KEYS.markupFloorBps, 2800, db);
}

function belowFloorRow(
  rowNumber: number,
  raw: RawImportRow,
  proposedMarkupBps: number,
  floorBps: number,
): ComputedRow {
  const floorPct = (floorBps / 100).toFixed(floorBps % 100 === 0 ? 0 : 2);
  return {
    rowNumber,
    diffType: "invalid",
    stagedData: raw,
    validationErrors: [
      `markup_bps ${proposedMarkupBps} is below the ${floorPct}% markup floor (${floorBps} bps) — raise markup_bps_override, lower cost, or set a route-level floor override before this row can be included.`,
    ],
    matchedProductId: null,
    included: false,
  };
}

/**
 * Classifies every row in a staged import against *current live state*
 * (never against a previous import) — matched by SKU (build prompt §11),
 * and by supplier name + route type for the sourcing route. Diffing
 * against live state, not the last import, is what makes re-importing an
 * unchanged file a no-op (test gate #14): every row lands on "unchanged"
 * and publish skips it.
 */
export async function computeDiff(db: AnyDb, rawRows: RawImportRow[]): Promise<ComputedRow[]> {
  const results: ComputedRow[] = [];
  const seenSkus = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2; // header is row 1
    const raw = rawRows[i]!;
    const parsed = catalogImportRowSchema.safeParse(raw);

    if (!parsed.success) {
      results.push({
        rowNumber,
        diffType: "invalid",
        stagedData: raw,
        validationErrors: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
        matchedProductId: null,
        included: false,
      });
      continue;
    }

    const row = parsed.data;
    seenSkus.add(row.sku);

    const [existingProduct] = await db.select().from(product).where(eq(product.sku, row.sku)).limit(1);

    if (!existingProduct) {
      const markupBps = row.markup_bps_override ?? (await defaultMarkupBpsForRouteType(row.route_type, db));
      const floorBps = await effectiveMarkupFloorBps(null, db);
      if (isBelowMarkupFloor(markupBps, floorBps)) {
        results.push(belowFloorRow(rowNumber, raw, markupBps, floorBps));
        continue;
      }
      results.push({
        rowNumber,
        diffType: "add",
        stagedData: { ...row, matchedSupplierId: null, matchedRouteId: null, proposedMarkupBps: markupBps },
        validationErrors: null,
        matchedProductId: null,
        included: true,
      });
      continue;
    }

    const [existingSupplier] = await db.select().from(supplier).where(ilike(supplier.name, row.supplier_name)).limit(1);
    const [existingRoute] = existingSupplier
      ? await db
          .select()
          .from(sourcingRoute)
          .where(
            and(
              eq(sourcingRoute.productId, existingProduct.id),
              eq(sourcingRoute.supplierId, existingSupplier.id),
              eq(sourcingRoute.routeType, row.route_type),
            ),
          )
          .limit(1)
      : [];

    const [latestPrice] = existingRoute
      ? await db
          .select()
          .from(priceEpoch)
          .where(and(eq(priceEpoch.productId, existingProduct.id), eq(priceEpoch.sourcingRouteId, existingRoute.id)))
          .orderBy(desc(priceEpoch.effectiveAt))
          .limit(1)
      : [];

    const [latestCheck] = existingRoute
      ? await db
          .select()
          .from(sourceCheck)
          .where(eq(sourceCheck.sourcingRouteId, existingRoute.id))
          .orderBy(desc(sourceCheck.checkedAt))
          .limit(1)
      : [];

    const proposedMarkupBps = row.markup_bps_override ?? (await defaultMarkupBpsForRouteType(row.route_type, db));
    const priceChanged =
      !latestPrice ||
      latestPrice.costMinor !== row.cost_minor ||
      latestPrice.markupBps !== proposedMarkupBps ||
      latestPrice.currencyCode !== row.currency_code;

    const availabilityChanged =
      row.stock_observed !== undefined && (!latestCheck || latestCheck.stockObserved !== row.stock_observed);

    // MSRP is product-level reference data, not a price: an MSRP-only
    // change never touches price_epoch. Blank (undefined) means "no change
    // proposed", matching every other optional column.
    const msrpChanged = row.msrp !== undefined && row.msrp !== (existingProduct.msrpMinor ?? undefined);

    // The floor only gates rows that would set a NEW price. A row that
    // leaves the price untouched (availability-only change, or no change at
    // all) is never invalidated by the floor — the price it proposes is the
    // price already live, which the floor did not block when it was set.
    if (priceChanged) {
      const floorBps = await effectiveMarkupFloorBps(existingRoute, db);
      if (isBelowMarkupFloor(proposedMarkupBps, floorBps)) {
        results.push(belowFloorRow(rowNumber, raw, proposedMarkupBps, floorBps));
        continue;
      }
    }

    const diffType: DiffType = priceChanged
      ? "price_change"
      : availabilityChanged
        ? "availability_change"
        : msrpChanged
          ? "msrp_change"
          : "unchanged";

    results.push({
      rowNumber,
      diffType,
      stagedData: {
        ...row,
        matchedSupplierId: existingSupplier?.id ?? null,
        matchedRouteId: existingRoute?.id ?? null,
        proposedMarkupBps,
        existingCostMinor: latestPrice?.costMinor ?? null,
        existingMarkupBps: latestPrice?.markupBps ?? null,
        existingStockObserved: latestCheck?.stockObserved ?? null,
      },
      validationErrors: null,
      matchedProductId: existingProduct.id,
      included: true,
    });
  }

  // Anything currently active but absent from this file entirely — owner
  // decides row-by-row whether that means "discontinue" (build prompt §11:
  // never silently deactivate, so `included` defaults false here).
  const activeProducts = await db.select().from(product).where(eq(product.status, "active"));
  const missingProducts = activeProducts.filter((p: typeof product.$inferSelect) => !seenSkus.has(p.sku));
  let rowNumber = rawRows.length + 2;
  for (const p of missingProducts) {
    results.push({
      rowNumber: rowNumber++,
      diffType: "missing",
      stagedData: { sku: p.sku, name: p.name },
      validationErrors: null,
      matchedProductId: p.id,
      included: false,
    });
  }

  return results;
}
