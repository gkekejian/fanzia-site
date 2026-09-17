import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { getPublicCatalog, getMemberCatalog } from "@/lib/catalog/queries";
import { toPublicProductDTO } from "@/lib/catalog/dto";
import {
  seedCurrency,
  makeSupplier,
  makeProduct,
  makeRoute,
  makePriceEpoch,
  makeSourceCheck,
} from "./catalogFixtures";

/**
 * Test gate #1: member prices and availability must never reach
 * unauthenticated responses — enforced at the data-access layer.
 *
 * The public catalog builder (getPublicCatalog) returns PublicProductDTO,
 * a type with no price/availability/supplier/cost/markup/margin field to
 * carry them: a caller cannot accidentally serialize a forbidden field
 * because it was never assigned onto the object in the first place. These
 * tests prove that structurally, against a database that *does* hold live
 * prices and source checks for the listed products.
 */
const FORBIDDEN_KEYS = [
  "priceMinor",
  "price",
  "availability",
  "costMinor",
  "cost",
  "supplier",
  "supplierId",
  "sourcingRoute",
  "route",
  "markup",
  "margin",
  "stockObserved",
  "checkedAt",
  "validUntil",
  "currencyCode",
];

describe("buyer DTO boundary (test gate #1)", () => {
  it("public catalog DTOs carry no price, availability, or cost-stack fields even when prices exist", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db);
    const priced = await makeProduct(db, { sku: "GATE1-PRICED" });
    const route = await makeRoute(db, { productId: priced.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: priced.id, sourcingRouteId: route.id });
    await makeSourceCheck(db, { sourcingRouteId: route.id });
    // An unpriced product must also appear — identity/specs only, no price.
    await makeProduct(db, { sku: "GATE1-UNPRICED" });

    const catalog = await getPublicCatalog(db);
    expect(catalog.length).toBe(2);

    for (const dto of catalog) {
      const keys = Object.keys(dto);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys, `public DTO must not contain key "${forbidden}"`).not.toContain(forbidden);
      }
    }

    // Belt and suspenders: the serialized JSON the route actually sends
    // must not contain any of these field names anywhere.
    const serialized = JSON.stringify(catalog);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(serialized, `public catalog JSON must not mention "${forbidden}"`).not.toContain(`"${forbidden}"`);
    }
  });

  it("toPublicProductDTO projects only the §18 identity/specs allowlist", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const row = await makeProduct(db, { sku: "GATE1-PROJECT" });
    const dto = toPublicProductDTO(row);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "sku",
        "name",
        "editionLanguage",
        "origin",
        "condition",
        "packsPerUnit",
        "cardsPerPack",
        "releaseStatus",
        "description",
      ].sort(),
    );
  });

  it("draft/inactive/non-visible products never appear in the public catalog", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    await makeProduct(db, { sku: "GATE1-DRAFT", status: "draft" });
    await makeProduct(db, { sku: "GATE1-HIDDEN", status: "active", publiclyVisible: false });
    const visible = await makeProduct(db, { sku: "GATE1-VISIBLE" });

    const catalog = await getPublicCatalog(db);
    expect(catalog.map((p) => p.sku)).toEqual([visible.sku]);
  });

  it("member catalog DOES include price and availability (the split works)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db, { sku: "GATE1-MEMBER" });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id, priceMinor: 13500 });
    await makeSourceCheck(db, { sourcingRouteId: route.id, confidence: "observed" });

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.priceMinor).toBe(13500);
    expect(catalog[0]!.availability).not.toBeNull();
    expect(catalog[0]!.availability!.stale).toBe(false);
  });

  it("unpriced products are excluded from the member catalog (nothing to request)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    await makeProduct(db, { sku: "GATE1-NOPRICE" });

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(0);
  });

  it("member DTOs never carry supplier identity or the cost stack", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db, "Secret Supplier Inc");
    const product = await makeProduct(db, { sku: "GATE1-NOCOST" });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id, costMinor: 10000 });

    const catalog = await getMemberCatalog(db);
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain("Secret Supplier Inc");
    expect(serialized).not.toContain("costMinor");
    expect(serialized).not.toContain("markupBps");
  });
});
