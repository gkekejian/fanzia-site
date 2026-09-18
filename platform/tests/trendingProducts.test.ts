import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { orderRequest, accountContact } from "@/db/schema";
import { getMemberCatalog, getTrendingProductRanks } from "@/lib/catalog/queries";
import {
  seedCurrency,
  makeSupplier,
  makeProduct,
  makeRoute,
  makePriceEpoch,
  makeAccount,
  type TestDb,
} from "./catalogFixtures";

/**
 * Trending = trailing 30 days of order_request lines with status in
 * (submitted, approved, invoiced), top 5 by units, requiring ≥2 distinct
 * accounts per product. Declined/expired requests never count, and an empty
 * catalog of demand yields no badges — never faked.
 */
async function makeOrderRequest(
  db: TestDb,
  opts: {
    accountId: string;
    productId: string;
    qty: number;
    status?: string;
    createdAt?: Date;
  },
) {
  const [contact] = await db
    .insert(accountContact)
    .values({ accountId: opts.accountId, name: "Buyer", email: `buyer-${Date.now()}-${Math.random()}@t.co` })
    .returning();
  await db.insert(orderRequest).values({
    accountId: opts.accountId,
    contactId: contact!.id,
    lines: [{ productId: opts.productId, sku: "S", name: "N", qtyRequested: opts.qty, unitPriceMinor: 1000, lineTotalMinor: opts.qty * 1000, currencyCode: "USD" }],
    subtotalMinor: opts.qty * 1000,
    status: opts.status ?? "submitted",
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
    createdAt: opts.createdAt ?? new Date(),
  });
}

async function pricedProduct(db: TestDb, sku: string) {
  const supplier = await makeSupplier(db);
  const product = await makeProduct(db, { sku, status: "active", publiclyVisible: true });
  const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
  await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id });
  return product;
}

describe("trending products", () => {
  it("ranks by units with a 2-account minimum", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const a = await pricedProduct(db, "TREND-A");
    const b = await pricedProduct(db, "TREND-B");
    const c = await pricedProduct(db, "TREND-C");
    const acc1 = await makeAccount(db);
    const acc2 = await makeAccount(db);

    // A: 100 units across 2 accounts → trending
    await makeOrderRequest(db, { accountId: acc1.id, productId: a.id, qty: 60 });
    await makeOrderRequest(db, { accountId: acc2.id, productId: a.id, qty: 40 });
    // B: 500 units but ONE account → not trending
    await makeOrderRequest(db, { accountId: acc1.id, productId: b.id, qty: 500 });
    // C: 2 accounts → trending, ranked below A
    await makeOrderRequest(db, { accountId: acc1.id, productId: c.id, qty: 5 });
    await makeOrderRequest(db, { accountId: acc2.id, productId: c.id, qty: 5 });

    const ranks = await getTrendingProductRanks(db);
    expect(ranks.get(a.id)).toBe(1);
    expect(ranks.get(c.id)).toBe(2);
    expect(ranks.has(b.id)).toBe(false);
  });

  it("ignores requests older than 30 days", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const p = await pricedProduct(db, "TREND-OLD");
    const acc1 = await makeAccount(db);
    const acc2 = await makeAccount(db);
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await makeOrderRequest(db, { accountId: acc1.id, productId: p.id, qty: 100, createdAt: old });
    await makeOrderRequest(db, { accountId: acc2.id, productId: p.id, qty: 100, createdAt: old });

    expect((await getTrendingProductRanks(db)).has(p.id)).toBe(false);
  });

  it("excludes declined and expired requests, counts approved and invoiced", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const p = await pricedProduct(db, "TREND-STATUS");
    const acc1 = await makeAccount(db);
    const acc2 = await makeAccount(db);
    await makeOrderRequest(db, { accountId: acc1.id, productId: p.id, qty: 50, status: "declined" });
    await makeOrderRequest(db, { accountId: acc2.id, productId: p.id, qty: 50, status: "expired" });
    expect((await getTrendingProductRanks(db)).has(p.id)).toBe(false);

    await makeOrderRequest(db, { accountId: acc1.id, productId: p.id, qty: 50, status: "approved" });
    await makeOrderRequest(db, { accountId: acc2.id, productId: p.id, qty: 50, status: "invoiced" });
    expect((await getTrendingProductRanks(db)).get(p.id)).toBe(1);
  });

  it("returns no badges on cold start — never faked", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    await pricedProduct(db, "TREND-COLD");
    expect((await getTrendingProductRanks(db)).size).toBe(0);

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.trending).toBe(false);
    expect(catalog[0]!.trendingRank).toBeNull();
  });

  it("caps at top 5", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const acc1 = await makeAccount(db);
    const acc2 = await makeAccount(db);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const p = await pricedProduct(db, `TREND-CAP-${i}`);
      ids.push(p.id);
      await makeOrderRequest(db, { accountId: acc1.id, productId: p.id, qty: 100 - i });
      await makeOrderRequest(db, { accountId: acc2.id, productId: p.id, qty: 100 - i });
    }
    const ranks = await getTrendingProductRanks(db);
    expect(ranks.size).toBe(5);
    // Highest units first
    expect(ranks.get(ids[0]!)).toBe(1);
    expect(ranks.get(ids[4]!)).toBe(5);
    expect(ranks.has(ids[5]!)).toBe(false);
  });
});
