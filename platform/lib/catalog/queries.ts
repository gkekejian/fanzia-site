import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { product, priceEpoch, sourcingRoute, sourceCheck, supplier } from "@/db/schema";
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
 * Member catalog: only products that are active, publicly listed, and
 * actually priced (nothing to request otherwise). Requires an
 * authenticated buyer account id — callers must resolve that via
 * lib/auth/buyerActor.ts before calling this, never from client input.
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

  return priced.map((p) => {
    const price = priceByProduct.get(p.id)!;
    const check = price.sourcingRouteId ? checkByRoute.get(price.sourcingRouteId) ?? null : null;
    return toMemberProductDTO(p, price, check);
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
