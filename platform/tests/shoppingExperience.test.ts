import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { orderRequest, accountContact } from "@/db/schema";
import { getMemberCatalog, getPurchasedProductIds } from "@/lib/catalog/queries";
import {
  seedCurrency,
  makeSupplier,
  makeProduct,
  makeRoute,
  makePriceEpoch,
  makeSourceCheck,
  makeAccount,
  type TestDb,
} from "./catalogFixtures";
import {
  availabilityChip,
  applyFilter,
  curatedRows,
  draftSummaryNames,
  draftTotals,
  estimateShippingRange,
  milestoneProgress,
  normalizeSearch,
  parseQuickOrderLines,
  perPackPriceMinor,
  reminderNamedLines,
  searchMatches,
  searchSuggestions,
  sellableUnitLabel,
  substituteSuggestions,
  unitNoun,
  unitSpecLines,
  EMPTY_FILTER,
  type ShoppingProduct,
} from "@/lib/member/shopping";
import { ORDER_MINIMUM_MINOR, SMALL_ORDER_FEE_MINOR, SMALL_ORDER_THRESHOLD_MINOR } from "@/lib/invoicing/rules";

function makeShoppingProduct(overrides: Partial<ShoppingProduct> = {}): ShoppingProduct {
  return {
    id: "prod-1",
    sku: "PRIS-EVO-BB",
    name: "Prismatic Evolutions Booster Box",
    editionLanguage: "English",
    origin: "United States",
    condition: "sealed",
    packsPerUnit: 36,
    cardsPerPack: 10,
    releaseStatus: "released",
    description: "36 packs",
    priceMinor: 18000,
    currencyCode: "USD",
    availability: {
      checkedAt: new Date().toISOString(),
      confidence: "observed",
      statusLabel: "Checked with our source",
      stale: false,
      stockObserved: 20,
    },
    msrpMinor: 21600,
    marginMinor: 3600,
    marginBps: 1667,
    trending: false,
    trendingRank: null,
    requiresImportAcknowledgment: false,
    ...overrides,
  };
}

describe("sellable units", () => {
  it("infers the unit noun from the product name", () => {
    expect(unitNoun("Prismatic Evolutions Booster Box")).toBe("Booster Box");
    expect(unitNoun("Mega Evolution Case")).toBe("Case");
    expect(unitNoun("151 Elite Trainer Box")).toBe("Elite Trainer Box");
    expect(unitNoun("Holiday Bundle")).toBe("Bundle");
    expect(unitNoun("Kanto Power Tin")).toBe("Tin");
    expect(unitNoun("Astral Radiance Booster Pack")).toBe("Booster Pack");
    expect(unitNoun("Something Obscure")).toBe("Box");
  });

  it("builds the unit-first headline", () => {
    expect(sellableUnitLabel("Prismatic Evolutions Booster Box", 36)).toBe("Booster Box — 36 packs");
    expect(sellableUnitLabel("Astral Radiance Booster Pack", 1)).toBe("Booster Pack");
  });

  it("computes the per-pack meta figure, never as a primary price", () => {
    expect(perPackPriceMinor(18000, 36)).toBe(500);
    expect(perPackPriceMinor(18000, 0)).toBeNull();
  });

  it("builds the 'In this box' spec block", () => {
    expect(unitSpecLines(makeShoppingProduct())).toEqual([
      "36 packs × 10 cards",
      "English",
      "Set code PRIS-EVO-BB",
      "Factory sealed",
    ]);
  });
});

describe("availability chips", () => {
  it("shows In stock when observed with healthy stock", () => {
    expect(availabilityChip(makeShoppingProduct()).label).toBe("In stock");
  });

  it("shows Only N left only on genuine low counts", () => {
    const chip = availabilityChip(
      makeShoppingProduct({ availability: { ...makeShoppingProduct().availability!, stockObserved: 3 } }),
    );
    expect(chip.label).toBe("Only 3 left");
    expect(chip.kind).toBe("warn");
  });

  it("does not show a low-stock chip at the threshold boundary", () => {
    const chip = availabilityChip(
      makeShoppingProduct({ availability: { ...makeShoppingProduct().availability!, stockObserved: 6 } }),
    );
    expect(chip.label).toBe("In stock");
  });

  it("shows Out of stock at zero, keeping the card honest", () => {
    const chip = availabilityChip(
      makeShoppingProduct({ availability: { ...makeShoppingProduct().availability!, stockObserved: 0 } }),
    );
    expect(chip.label).toBe("Out of stock");
    expect(chip.kind).toBe("bad");
  });

  it("flags stale availability instead of claiming stock", () => {
    const chip = availabilityChip(
      makeShoppingProduct({ availability: { ...makeShoppingProduct().availability!, stale: true } }),
    );
    expect(chip.label).toBe("Availability needs refresh");
    expect(chip.kind).toBe("warn");
  });

  it("says Not yet checked when no check exists", () => {
    const chip = availabilityChip(makeShoppingProduct({ availability: null }));
    expect(chip.label).toBe("Not yet checked");
  });

  it("shows Preorder from release status", () => {
    const chip = availabilityChip(makeShoppingProduct({ releaseStatus: "preorder — ships March" }));
    expect(chip.label).toBe("Preorder");
  });
});

describe("dual-milestone progress", () => {
  it("frames below-minimum as a goal", () => {
    const p = milestoneProgress(29000);
    expect(p.minMet).toBe(false);
    expect(p.feeApplies).toBe(true);
    expect(p.toMinimumMinor).toBe(ORDER_MINIMUM_MINOR - 29000);
    expect(p.toFeeFreeMinor).toBe(SMALL_ORDER_THRESHOLD_MINOR - 29000);
    expect(p.message).toContain("from the $500 minimum");
    expect(p.message).toContain("dropping the $25 fee");
  });

  it("unlocks submit at $500 and keeps the fee until $750", () => {
    const p = milestoneProgress(60000);
    expect(p.minMet).toBe(true);
    expect(p.feeApplies).toBe(true);
    expect(p.feeMinor).toBe(SMALL_ORDER_FEE_MINOR);
    expect(p.message).toContain("Minimum met");
  });

  it("drops the fee at $750", () => {
    const p = milestoneProgress(75000);
    expect(p.minMet).toBe(true);
    expect(p.feeApplies).toBe(false);
    expect(p.feeMinor).toBe(0);
    expect(p.barPct).toBe(100);
  });

  it("caps the bar and places the $500 marker at 2/3", () => {
    const p = milestoneProgress(200000);
    expect(p.barPct).toBe(100);
    expect(p.minMarkerPct).toBeCloseTo(66.67, 1);
  });
});

describe("search", () => {
  const products = [
    makeShoppingProduct({ id: "a", name: "Prismatic Evolutions Booster Box", sku: "ME2.5-BB" }),
    makeShoppingProduct({ id: "b", name: "Yu-Gi-Oh! Alliance Insight Booster Box", sku: "ALIN-BB" }),
  ];

  it("normalizes punctuation so yu-gi-oh matches Yu-Gi-Oh!", () => {
    expect(normalizeSearch("Yu-Gi-Oh!")).toBe("yugioh");
    expect(searchMatches("yugioh", products[1]!)).toBe(true);
    expect(searchMatches("ME2.5", products[0]!)).toBe(true);
    expect(searchMatches("prismatic evo", products[0]!)).toBe(true);
  });

  it("requires every token to match", () => {
    expect(searchMatches("prismatic japanese", products[0]!)).toBe(false);
    expect(searchMatches("", products[0]!)).toBe(true);
  });

  it("suggests with the unit line", () => {
    const s = searchSuggestions("prism", products);
    expect(s).toHaveLength(1);
    expect(s[0]!.unitLine).toContain("Booster Box — 36 packs");
  });
});

describe("curated rows", () => {
  it("uses only real trending data for bestsellers and caps rows", () => {
    const products = [
      makeShoppingProduct({ id: "t1", trending: true, trendingRank: 1 }),
      makeShoppingProduct({ id: "t2", trending: true, trendingRank: 2 }),
      makeShoppingProduct({ id: "n1", trending: false }),
      makeShoppingProduct({ id: "j1", trending: false, editionLanguage: "Japanese", origin: "Japan" }),
    ];
    const rows = curatedRows(products);
    expect(rows.bestsellers.map((p) => p.id)).toEqual(["t1", "t2"]);
    expect(rows.japaneseImports.map((p) => p.id)).toEqual(["j1"]);
    // restocked: checked now, in stock, non-trending
    expect(rows.restocked.map((p) => p.id).sort()).toEqual(["j1", "n1"]);
  });

  it("excludes out-of-stock and stale products from restocked", () => {
    const products = [
      makeShoppingProduct({
        id: "oos",
        availability: { ...makeShoppingProduct().availability!, stockObserved: 0 },
      }),
      makeShoppingProduct({
        id: "stale",
        availability: { ...makeShoppingProduct().availability!, stale: true },
      }),
    ];
    expect(curatedRows(products).restocked).toHaveLength(0);
  });
});

describe("filters", () => {
  const products = [
    makeShoppingProduct({ id: "a", name: "Prismatic Evolutions Booster Box", editionLanguage: "English", priceMinor: 18000 }),
    makeShoppingProduct({ id: "b", name: "Mega Evolution Case", editionLanguage: "Japanese", priceMinor: 90000, packsPerUnit: 216 }),
  ];

  it("applies type, language, and price-band facets on real fields", () => {
    expect(applyFilter(products, { ...EMPTY_FILTER, type: "Case" }, new Set()).map((p) => p.id)).toEqual(["b"]);
    expect(applyFilter(products, { ...EMPTY_FILTER, language: "Japanese" }, new Set()).map((p) => p.id)).toEqual(["b"]);
    expect(applyFilter(products, { ...EMPTY_FILTER, priceBand: "over250" }, new Set()).map((p) => p.id)).toEqual(["b"]);
  });

  it("filters to bought-before ids only", () => {
    expect(applyFilter(products, { ...EMPTY_FILTER, boughtBefore: true }, new Set(["a"])).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("substitutes", () => {
  it("suggests same-unit in-stock products by price proximity, never the product itself", () => {
    const target = makeShoppingProduct({ id: "t", priceMinor: 18000 });
    const products = [
      target,
      makeShoppingProduct({ id: "s1", priceMinor: 19000 }),
      makeShoppingProduct({ id: "s2", priceMinor: 12000, name: "Other Brand Case", packsPerUnit: 216 }),
      makeShoppingProduct({
        id: "oos",
        priceMinor: 17500,
        availability: { ...makeShoppingProduct().availability!, stockObserved: 0 },
      }),
    ];
    const subs = substituteSuggestions(target, products);
    expect(subs.map((p) => p.id)).toEqual(["s1"]);
  });
});

describe("shipping estimate and draft totals", () => {
  it("returns a labeled planning range that grows with units", () => {
    const one = estimateShippingRange(1);
    const ten = estimateShippingRange(10);
    expect(one.lowMinor).toBeLessThan(one.highMinor);
    expect(ten.lowMinor).toBeGreaterThan(one.lowMinor);
    expect(estimateShippingRange(0)).toEqual({ lowMinor: 0, highMinor: 0 });
  });

  it("totals lines from prices and applies the $25 fee under $750", () => {
    const t = draftTotals([{ productId: "a", qtyRequested: 2 }], new Map([["a", { priceMinor: 18000 }]]));
    expect(t.units).toBe(2);
    expect(t.subtotalMinor).toBe(36000);
    expect(t.feeMinor).toBe(SMALL_ORDER_FEE_MINOR);
    const big = draftTotals([{ productId: "a", qtyRequested: 5 }], new Map([["a", { priceMinor: 18000 }]]));
    expect(big.feeMinor).toBe(0);
  });

  it("ignores unknown products and non-positive quantities", () => {
    const t = draftTotals(
      [
        { productId: "missing", qtyRequested: 3 },
        { productId: "a", qtyRequested: 0 },
      ],
      new Map([["a", { priceMinor: 18000 }]]),
    );
    expect(t.units).toBe(0);
    expect(t.subtotalMinor).toBe(0);
  });
});

describe("quick-order CSV parser", () => {
  const catalog = [
    { id: "p1", sku: "PRIS-EVO-BB" },
    { id: "p2", sku: "STEL-CRY-BB" },
  ];

  it("parses SKU, qty lines and resolves case-insensitively", () => {
    const { ok, errors } = parseQuickOrderLines("pris-evo-bb, 3\nSTEL-CRY-BB;2", catalog);
    expect(errors).toHaveLength(0);
    expect(ok).toEqual([
      { sku: "pris-evo-bb", qty: 3, productId: "p1" },
      { sku: "STEL-CRY-BB", qty: 2, productId: "p2" },
    ]);
  });

  it("flags unknown SKUs, bad quantities, and duplicates per line", () => {
    const { ok, errors } = parseQuickOrderLines("NOPE, 1\nPRIS-EVO-BB, x\nPRIS-EVO-BB, 2\nPRIS-EVO-BB, 3", catalog);
    expect(ok).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 4]);
  });
});

describe("draft naming", () => {
  const names = new Map([
    ["a", "Prismatic Evolutions Booster Box"],
    ["b", "Stellar Crystal Booster Box"],
  ]);
  const lines = [
    { productId: "a", qtyRequested: 3 },
    { productId: "b", qtyRequested: 2 },
  ];

  it("names the top draft lines for the resume banner", () => {
    expect(draftSummaryNames(lines, names)).toBe(
      "3× Prismatic Evolutions Booster Box, 2× Stellar Crystal Booster Box",
    );
  });

  it("builds named lines for the reminder email", () => {
    expect(reminderNamedLines(lines, names)).toEqual([
      { name: "Prismatic Evolutions Booster Box", qty: 3 },
      { name: "Stellar Crystal Booster Box", qty: 2 },
    ]);
  });
});

describe("buyer DTO stock figure (honest chips)", () => {
  it("carries stockObserved on the member DTO so chips are honest, never faked", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db, { sku: "STOCK-LOW" });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id });
    await makeSourceCheck(db, { sourcingRouteId: route.id, stockObserved: 3 });

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.availability!.stockObserved).toBe(3);
  });

  it("still excludes supplier identity and cost stack with the new field", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db, "Secret Stock Supplier");
    const product = await makeProduct(db, { sku: "STOCK-SECRET" });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id, costMinor: 10000 });
    await makeSourceCheck(db, { sourcingRouteId: route.id, stockObserved: 7 });

    const catalog = await getMemberCatalog(db);
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain("Secret Stock Supplier");
    expect(serialized).not.toContain("costMinor");
    expect(serialized).not.toContain("markupBps");
  });
});

describe("purchased product ids (bought-before filter)", () => {
  async function makeRequestWithLine(db: TestDb, accountId: string, productId: string, status: string) {
    const [contact] = await db
      .insert(accountContact)
      .values({ accountId, name: "Buyer", email: `bought-${Date.now()}-${Math.random()}@t.co` })
      .returning();
    await db.insert(orderRequest).values({
      accountId,
      contactId: contact!.id,
      lines: [{ productId, sku: "S", name: "N", qtyRequested: 2, unitPriceMinor: 1000, lineTotalMinor: 2000, currencyCode: "USD" }],
      subtotalMinor: 2000,
      status,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
  }

  it("returns distinct product ids from real (non-declined) requests only", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const account = await makeAccount(db);
    const other = await makeAccount(db);
    const bought = await makeProduct(db, { sku: "BOUGHT-1" });
    const declined = await makeProduct(db, { sku: "DECLINED-1" });
    const otherAcct = await makeProduct(db, { sku: "OTHER-ACCT" });

    await makeRequestWithLine(db, account.id, bought.id, "invoiced");
    await makeRequestWithLine(db, account.id, bought.id, "approved"); // duplicate line, deduped
    await makeRequestWithLine(db, account.id, declined.id, "declined");
    await makeRequestWithLine(db, other.id, otherAcct.id, "invoiced");

    const ids = await getPurchasedProductIds(account.id, db);
    expect(ids).toEqual([bought.id]);
  });
});
