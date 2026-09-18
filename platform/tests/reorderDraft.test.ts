import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { invoice } from "@/db/schema";
import { reorderDraftFromInvoice, ReorderNotFoundError } from "@/lib/catalog/reorder";
import { getDraftRequest } from "@/lib/catalog/draftRequest";
import {
  seedCurrency,
  makeSupplier,
  makeProduct,
  makeRoute,
  makePriceEpoch,
  makeAccount,
} from "./catalogFixtures";

/**
 * One-click reorder: an invoice's lines are copied into the buyer's draft,
 * merged with existing draft quantities. Only products currently active,
 * visible, and priced are re-added; the rest are reported as skipped with
 * an honest reason. An invoice from another account is invisible (404).
 */
async function makeInvoice(db: Parameters<typeof makeAccount>[0], accountId: string, lines: { productId: string; name: string; qtyRequested: number }[]) {
  const [row] = await db
    .insert(invoice)
    .values({
      invoiceNumber: `INV-TEST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      accountId,
      lines: lines.map((l) => ({
        ...l,
        sku: "SKU",
        unitPriceMinor: 13500,
        lineTotalMinor: l.qtyRequested * 13500,
        currencyCode: "USD",
      })),
      subtotalMinor: lines.reduce((s, l) => s + l.qtyRequested * 13500, 0),
      totalMinor: lines.reduce((s, l) => s + l.qtyRequested * 13500, 0),
      status: "paid",
    })
    .returning();
  return row!;
}

async function pricedProduct(db: Parameters<typeof makeAccount>[0], sku: string, opts: { active?: boolean; visible?: boolean; priced?: boolean } = {}) {
  const supplier = await makeSupplier(db);
  const product = await makeProduct(db, {
    sku,
    status: opts.active === false ? "inactive" : "active",
    publiclyVisible: opts.visible === false ? false : true,
  });
  const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
  if (opts.priced !== false) await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id });
  return product;
}

describe("one-click reorder", () => {
  it("maps invoice lines into the draft", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const p = await pricedProduct(db, "REORDER-OK");
    const account = await makeAccount(db);
    const inv = await makeInvoice(db, account.id, [{ productId: p.id, name: p.name, qtyRequested: 4 }]);

    const result = await reorderDraftFromInvoice(account.id, inv.id, db);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.qtyRequested).toBe(4);
    expect(result.skipped).toHaveLength(0);

    const draft = await getDraftRequest(account.id, db);
    expect(draft!.lines).toEqual([{ productId: p.id, qtyRequested: 4 }]);
  });

  it("merges with the existing draft, summing quantities", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const p = await pricedProduct(db, "REORDER-MERGE");
    const account = await makeAccount(db);
    const inv = await makeInvoice(db, account.id, [{ productId: p.id, name: p.name, qtyRequested: 4 }]);

    await reorderDraftFromInvoice(account.id, inv.id, db);
    await reorderDraftFromInvoice(account.id, inv.id, db);

    const draft = await getDraftRequest(account.id, db);
    expect(draft!.lines).toEqual([{ productId: p.id, qtyRequested: 8 }]);
  });

  it("skips inactive, hidden, and unpriced products with honest reasons", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const gone = await pricedProduct(db, "REORDER-GONE", { active: false });
    const hidden = await pricedProduct(db, "REORDER-HIDDEN", { visible: false });
    const unpriced = await pricedProduct(db, "REORDER-NOPRICE", { priced: false });
    const account = await makeAccount(db);
    const inv = await makeInvoice(db, account.id, [
      { productId: gone.id, name: "Gone", qtyRequested: 1 },
      { productId: hidden.id, name: "Hidden", qtyRequested: 2 },
      { productId: unpriced.id, name: "Unpriced", qtyRequested: 3 },
      { productId: "00000000-0000-0000-0000-000000000000", name: "Deleted", qtyRequested: 1 },
    ]);

    const result = await reorderDraftFromInvoice(account.id, inv.id, db);
    expect(result.added).toHaveLength(0);
    expect(result.skipped).toHaveLength(4);
    for (const s of result.skipped) {
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });

  it("throws ReorderNotFoundError for another account's invoice", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const p = await pricedProduct(db, "REORDER-OTHER");
    const owner = await makeAccount(db);
    const stranger = await makeAccount(db);
    const inv = await makeInvoice(db, owner.id, [{ productId: p.id, name: p.name, qtyRequested: 1 }]);

    await expect(reorderDraftFromInvoice(stranger.id, inv.id, db)).rejects.toBeInstanceOf(ReorderNotFoundError);
  });

  it("throws ReorderNotFoundError for a missing invoice", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const account = await makeAccount(db);
    await expect(
      reorderDraftFromInvoice(account.id, "00000000-0000-0000-0000-000000000000", db),
    ).rejects.toBeInstanceOf(ReorderNotFoundError);
  });
});
