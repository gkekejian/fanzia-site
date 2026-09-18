import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { product, priceEpoch, sourcingRoute, sourceCheck, supplier, orderRequest } from "@/db/schema";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import type { Actor } from "@/lib/auth/rbac";
import { canSeeCostStack } from "@/lib/auth/rbac";
import {
  toPublicProductDTO,
  toMemberProductDTO,
  toAdminProductDTO,
  type PublicProductDTO,
  type MemberProductDTO,
  type AdminProductDTO,
} from "./dto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * The current price for a product is the latest price_epoch row by
 * effectiveAt (price_epoch is append-only — see migration 0006). Returns
 * one row per product for the given ids, or all priced products if
 * `productIds` is omitted.
 */
async function latestPriceEpochsByProduct(db: AnyDb, productIds?: string[]) {
  const rows = await db
    .select()
    .from(priceEpoch)
    .where(productIds ? inArray(priceEpoch.productId, productIds) : undefined)
    .orderBy(desc(priceEpoch.effectiveAt));
  const byProduct = new Map<string, typeof priceEpoch.$inferSelect>();
  for (const row of rows) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, row);
  }
  return byProduct;
}

async function latestSourceChecksByRoute(db: AnyDb, routeIds: string[]) {
  if (routeIds.length === 0) return new Map<string, typeof sourceCheck.$inferSelect>();
  const rows = await db
    .select()
    .from(sourceCheck)
    .where(inArray(sourceCheck.sourcingRouteId, routeIds))
    .orderBy(desc(sourceCheck.checkedAt));
  const byRoute = new Map<string, typeof sourceCheck.$inferSelect>();
  for (const row of rows) {
    if (!byRoute.has(row.sourcingRouteId)) byRoute.set(row.sourcingRouteId, row);
  }
  return byRoute;
}

/**
 * Public catalog: identity/specs only, for `status = 'active'` and
 * `publiclyVisible = true` products, regardless of whether a price exists.
 * No caller of this function ever has access to price, availability,
 * supplier, or cost (test gate #1) — the DTO type itself has no field to
 * carry them.
 */
export async function getPublicCatalog(db: AnyDb = defaultDb): Promise<PublicProductDTO[]> {
  const rows = await db
    .select()
    .from(product)
    .where(and(eq(product.status, "active"), eq(product.publiclyVisible, true)));
  return rows.map(toPublicProductDTO);
}

/**
 * Trending products: aggregate order_request lines from the trailing 30
 * days, counting only requests that represent real buyer intent
 * (submitted / approved / invoiced — declined and expired are excluded).
 * A product is "trending" when it is in the top 5 by units ordered AND at
 * least 2 distinct accounts ordered it, so one big single-buyer order can
 * never manufacture a badge. Cold start (no qualifying data) returns an
 * empty map — badges are never faked.
 *
 * Returns a map of productId → 1-based rank.
 */
export async function getTrendingProductRanks(
  db: AnyDb = defaultDb,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ accountId: orderRequest.accountId, lines: orderRequest.lines })
    .from(orderRequest)
    .where(
      and(
        gte(orderRequest.createdAt, since),
        inArray(orderRequest.status, ["submitted", "approved", "invoiced"]),
      ),
    );

  const unitsByProduct = new Map<string, number>();
  const accountsByProduct = new Map<string, Set<string>>();
  for (const row of rows) {
    const lines = (row.lines ?? []) as { productId?: string; qtyRequested?: number }[];
    for (const line of lines) {
      const qty = line.qtyRequested ?? 0;
      if (!line.productId || qty <= 0) continue;
      unitsByProduct.set(line.productId, (unitsByProduct.get(line.productId) ?? 0) + qty);
      let accounts = accountsByProduct.get(line.productId);
      if (!accounts) {
        accounts = new Set();
        accountsByProduct.set(line.productId, accounts);
      }
      accounts.add(row.accountId);
    }
  }

  const ranked = [...unitsByProduct.entries()]
    .filter(([productId]) => (accountsByProduct.get(productId)?.size ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const ranks = new Map<string, number>();
  ranked.forEach(([productId], i) => ranks.set(productId, i + 1));
  return ranks;
}
/**
 * Member catalog: only products that are active, publicly listed, and
 * actually priced (nothing to request otherwise). Requires an
 * authenticated buyer account id — callers must resolve that via
 * lib/auth/buyerActor.ts before calling this, never from client input.
 * Trending ranks are attached per product (getTrendingProductRanks).
 */
export async function getMemberCatalog(db: AnyDb = defaultDb): Promise<MemberProductDTO[]> {
  const rows = await db
    .select()
    .from(product)
    .where(and(eq(product.status, "active"), eq(product.publiclyVisible, true)));
  const productIds = rows.map((r) => r.id);
  const priceByProduct = await latestPriceEpochsByProduct(db, productIds);

  const priced = rows.filter((r) => priceByProduct.has(r.id));
  const routeIds = priced
    .map((r) => priceByProduct.get(r.id)!.sourcingRouteId)
    .filter((id): id is string => Boolean(id));
  const checkByRoute = await latestSourceChecksByRoute(db, routeIds);
  const routeRows = routeIds.length
    ? await db.select().from(sourcingRoute).where(inArray(sourcingRoute.id, routeIds))
    : [];
  const routeTypeById = new Map(routeRows.map((r) => [r.id, r.routeType]));
  const trendingRanks = await getTrendingProductRanks(db);

  return priced.map((p) => {
    const price = priceByProduct.get(p.id)!;
    const check = price.sourcingRouteId ? checkByRoute.get(price.sourcingRouteId) ?? null : null;
    const routeType = price.sourcingRouteId ? routeTypeById.get(price.sourcingRouteId) ?? null : null;
    const trendingRank = trendingRanks.get(p.id) ?? null;
    return toMemberProductDTO(p, price, check, routeType === "import", {
      trending: trendingRank !== null,
      trendingRank,
    });
  });
}

/**
 * Admin catalog: every product regardless of status/visibility, plus the
 * cost stack when `actor` is entitled to see it (lib/auth/rbac.ts
 * `canSeeCostStack`). Never called from a buyer- or public-facing route.
 */
export async function getAdminCatalog(actor: Actor, db: AnyDb = defaultDb): Promise<AdminProductDTO[]> {
  const rows = await db.select().from(product);
  const productIds = rows.map((r) => r.id);
  const priceByProduct = await latestPriceEpochsByProduct(db, productIds);

  const routeIds = Array.from(priceByProduct.values())
    .map((p) => p.sourcingRouteId)
    .filter((id): id is string => Boolean(id));
  const routes = routeIds.length
    ? await db.select().from(sourcingRoute).where(inArray(sourcingRoute.id, routeIds))
    : [];
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const supplierIds = routes.map((r) => r.supplierId);
  const suppliers = supplierIds.length ? await db.select().from(supplier).where(inArray(supplier.id, supplierIds)) : [];
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const checkByRoute = await latestSourceChecksByRoute(db, routeIds);

  const canSeeCost = canSeeCostStack(actor);
  const markupFloorBps = await getSetting<number>(SETTINGS_KEYS.markupFloorBps, 2800, db);

  return rows.map((p) => {
    const price = priceByProduct.get(p.id) ?? null;
    const route = price?.sourcingRouteId ? routeById.get(price.sourcingRouteId) ?? null : null;
    const supplierName = route ? supplierNameById.get(route.supplierId) ?? null : null;
    const check = route ? checkByRoute.get(route.id) ?? null : null;
    return toAdminProductDTO(canSeeCost, p, price, route, supplierName, markupFloorBps, check);
  });
}
