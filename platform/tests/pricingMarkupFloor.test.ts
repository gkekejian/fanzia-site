import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { catalogImport, catalogImportRow, product, priceEpoch } from "@/db/schema";
import {
  priceFromCostAndMarkup,
  realizedGrossMarginBps,
  isBelowMarkupFloor,
} from "@/lib/catalog/pricingMath";
import { defaultMarkupBpsForRouteType } from "@/lib/catalog/pricingDefaults";
import { effectiveMarkupFloorBps } from "@/lib/catalog/import/diff";
import {
  stageCatalogImport,
  approveCatalogImport,
  publishCatalogImport,
} from "@/lib/catalog/import/service";
import { SETTINGS_KEYS, setSetting } from "@/lib/settings";
import {
  seedCurrency,
  makeOwner,
  makeSupplier,
  makeProduct,
  makeRoute,
  IMPORT_HEADERS,
  csvRow,
} from "./catalogFixtures";

/**
 * Build prompt §9: markup is not margin. `price = cost × (1 + markup_bps)`
 * and `realized_gross_margin_bps = (price − cost) / price` are separate,
 * separately-labeled fields everywhere. The former 28% "margin floor" is a
 * 28% markup floor (`markup_floor_bps`, default 2800) enforced on every new
 * price epoch written by the import pipeline — rows that would price below
 * it are flagged invalid and excluded, never silently repriced.
 */
describe("markup vs margin math", () => {
  it("35% markup on $100.00 cost yields a $135.00 price", () => {
    expect(priceFromCostAndMarkup(10000, 3500)).toBe(13500);
  });

  it("a 35% markup is never reported as a 35% margin (test gate #6)", () => {
    // Build prompt §9's worked example: 35% markup → 25.93% gross margin.
    const margin = realizedGrossMarginBps(10000, 13500);
    expect(margin).toBe(2593);
    expect(margin).toBeLessThan(3500);
  });

  it("margin is always below the markup that produced it", () => {
    for (const markup of [100, 1750, 2800, 3500, 10000]) {
      const price = priceFromCostAndMarkup(12345, markup);
      expect(realizedGrossMarginBps(12345, price)).toBeLessThan(markup);
    }
  });

  it("isBelowMarkupFloor compares strictly", () => {
    expect(isBelowMarkupFloor(2799, 2800)).toBe(true);
    expect(isBelowMarkupFloor(2800, 2800)).toBe(false);
    expect(isBelowMarkupFloor(3500, 2800)).toBe(false);
  });
});

describe("markup defaults and floor configuration", () => {
  it("import routes default to 35% markup, domestic to 17.5%", async () => {
    const { db } = await createTestDb();
    expect(await defaultMarkupBpsForRouteType("import", db)).toBe(3500);
    expect(await defaultMarkupBpsForRouteType("domestic", db)).toBe(1750);
  });

  it("defaults are admin-configurable settings", async () => {
    const { db } = await createTestDb();
    await setSetting(SETTINGS_KEYS.importMarkupBpsDefault, 4000, "test", db);
    expect(await defaultMarkupBpsForRouteType("import", db)).toBe(4000);
  });

  it("the floor defaults to 2800 bps (28%) and a route override wins", async () => {
    const { db } = await createTestDb();
    expect(await effectiveMarkupFloorBps(null, db)).toBe(2800);
    expect(await effectiveMarkupFloorBps({ markupFloorBpsOverride: 1500 }, db)).toBe(1500);
    expect(await effectiveMarkupFloorBps({ markupFloorBpsOverride: null }, db)).toBe(2800);
  });

  it("the floor itself is an admin-configurable setting", async () => {
    const { db } = await createTestDb();
    await setSetting(SETTINGS_KEYS.markupFloorBps, 3000, "test", db);
    expect(await effectiveMarkupFloorBps(null, db)).toBe(3000);
  });
});

const baseRow = (overrides: Record<string, string | number | undefined> = {}) =>
  csvRow([
    "FLOOR-001",
    "Floor Test Box",
    "Japanese",
    "Japan",
    "sealed",
    30,
    5,
    "released",
    "Fixture row for markup floor tests.",
    "Test Supplier Co",
    "import",
    "USD",
    10000,
    overrides.markup_bps_override,
    20,
    "member_page",
    "observed",
    "",
  ]);

describe("28% markup floor enforcement in the import pipeline", () => {
  it("a row below the floor is staged as invalid and excluded — never silently repriced", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const csv = [IMPORT_HEADERS, baseRow({ markup_bps_override: 1000 })].join("\n");
    const imp = await stageCatalogImport({ actor, filename: "floor.csv", buffer: Buffer.from(csv) }, db);

    const rows = await db
      .select()
      .from(catalogImportRow)
      .where(eq(catalogImportRow.catalogImportId, imp.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diffType).toBe("invalid");
    expect(rows[0]!.included).toBe(false);
    expect(JSON.stringify(rows[0]!.validationErrors)).toContain("markup floor");

    // Toggling it back on is refused — an invalid row can never be included.
    const { setCatalogImportRowIncluded } = await import("@/lib/catalog/import/service");
    await expect(
      setCatalogImportRowIncluded({ importId: imp.id, rowId: rows[0]!.id, included: true, actor }, db),
    ).rejects.toThrow();

    // And publishing after approval writes nothing for it.
    await approveCatalogImport({ importId: imp.id, actor }, db);
    const result = await publishCatalogImport({ importId: imp.id, actor }, db);
    expect(result.executed).toBe(true);
    expect(await db.select().from(product)).toHaveLength(0);
    expect(await db.select().from(priceEpoch)).toHaveLength(0);
  });

  it("a row at exactly the floor is accepted", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const csv = [IMPORT_HEADERS, baseRow({ markup_bps_override: 2800 })].join("\n");
    const imp = await stageCatalogImport({ actor, filename: "floor-exact.csv", buffer: Buffer.from(csv) }, db);
    const rows = await db
      .select()
      .from(catalogImportRow)
      .where(eq(catalogImportRow.catalogImportId, imp.id));
    expect(rows[0]!.diffType).toBe("add");
    expect(rows[0]!.included).toBe(true);

    await approveCatalogImport({ importId: imp.id, actor }, db);
    await publishCatalogImport({ importId: imp.id, actor }, db);
    const [epoch] = await db.select().from(priceEpoch);
    expect(epoch!.markupBps).toBe(2800);
    expect(epoch!.priceMinor).toBe(12800); // 10000 × 1.28
    expect(epoch!.realizedGrossMarginBps).toBe(2188); // 2800/12800 — margin, not markup
  });

  it("a route-level floor override lets a lower markup through for that route only", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const prod = await makeProduct(db, { sku: "FLOOR-001" });
    await makeRoute(db, {
      productId: prod.id,
      supplierId: supplier.id,
      routeType: "import",
      markupFloorBpsOverride: 1000,
    });

    const csv = [IMPORT_HEADERS, baseRow({ markup_bps_override: 1000 })].join("\n");
    const imp = await stageCatalogImport({ actor, filename: "floor-override.csv", buffer: Buffer.from(csv) }, db);
    const rows = await db
      .select()
      .from(catalogImportRow)
      .where(eq(catalogImportRow.catalogImportId, imp.id));
    expect(rows[0]!.diffType).toBe("price_change");
    expect(rows[0]!.included).toBe(true);

    await approveCatalogImport({ importId: imp.id, actor }, db);
    await publishCatalogImport({ importId: imp.id, actor }, db);
    const [epoch] = await db.select().from(priceEpoch);
    expect(epoch!.markupBps).toBe(1000);
  });

  it("a below-floor markup is blocked even when the floor is raised by settings", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    await setSetting(SETTINGS_KEYS.markupFloorBps, 4000, "test", db);

    // 3500 is the default import markup — legal under the 2800 default, but
    // blocked once the owner raises the floor to 4000.
    const csv = [IMPORT_HEADERS, baseRow({})].join("\n");
    const imp = await stageCatalogImport({ actor, filename: "floor-raised.csv", buffer: Buffer.from(csv) }, db);
    const rows = await db
      .select()
      .from(catalogImportRow)
      .where(eq(catalogImportRow.catalogImportId, imp.id));
    expect(rows[0]!.diffType).toBe("invalid");
    expect(rows[0]!.included).toBe(false);
  });

  it("the floor never blocks an availability-only change (it sets no price)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const prod = await makeProduct(db, { sku: "FLOOR-001" });
    const route = await makeRoute(db, { productId: prod.id, supplierId: supplier.id, routeType: "import" });
    // Existing price epoch at the default 3500 import markup.
    const { priceEpoch: epochTable, sourceCheck: checkTable } = await import("@/db/schema");
    await db.insert(epochTable).values({
      productId: prod.id,
      sourcingRouteId: route.id,
      costMinor: 10000,
      currencyCode: "USD",
      markupBps: 3500,
      priceMinor: 13500,
      realizedGrossMarginBps: 2593,
    });
    await db.insert(checkTable).values({
      sourcingRouteId: route.id,
      stockObserved: 5,
      priceObservedMinor: 10000,
      currencyCode: "USD",
      method: "member_page",
      confidence: "observed",
      validUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    // Same price as live, different stock → availability_change, not blocked.
    const csv = [IMPORT_HEADERS, baseRow({ stock_observed: undefined })].join("\n");
    const csv2 = [IMPORT_HEADERS, csvRow([
      "FLOOR-001", "Floor Test Box", "Japanese", "Japan", "sealed", 30, 5, "released",
      "Fixture row for markup floor tests.", "Test Supplier Co", "import", "USD", 10000,
      undefined, 99, "member_page", "observed", "",
    ])].join("\n");
    void csv;
    const imp = await stageCatalogImport({ actor, filename: "floor-avail.csv", buffer: Buffer.from(csv2) }, db);
    const rows = await db
      .select()
      .from(catalogImportRow)
      .where(eq(catalogImportRow.catalogImportId, imp.id));
    expect(rows[0]!.diffType).toBe("availability_change");
    expect(rows[0]!.included).toBe(true);
  });

  it("publish is a second line of defense: a smuggled below-floor row is skipped, never written", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    // Craft staged rows directly (bypassing computeDiff's floor check) to
    // prove publish re-checks before writing any price epoch.
    const [imp] = await db
      .insert(catalogImport)
      .values({
        uploadedBy: actor.kind === "owner" ? actor.user.id : "x",
        originalFilename: "smuggled.csv",
        fileFormat: "csv",
        status: "approved",
        rowCount: 1,
      })
      .returning();
    await db.insert(catalogImportRow).values({
      catalogImportId: imp!.id,
      rowNumber: 2,
      diffType: "add",
      stagedData: {
        sku: "SMUGGLE-1",
        name: "Smuggled",
        edition_language: "Japanese",
        origin: "Japan",
        condition: "sealed",
        packs_per_unit: 30,
        cards_per_pack: 5,
        release_status: "released",
        description: "x",
        supplier_name: "Test Supplier Co",
        route_type: "import",
        currency_code: "USD",
        cost_minor: 10000,
        matchedSupplierId: null,
        matchedRouteId: null,
        proposedMarkupBps: 500, // below the 2800 floor
      },
      validationErrors: null,
      included: true,
    });

    const result = await publishCatalogImport({ importId: imp!.id, actor }, db);
    expect(result.executed).toBe(true);
    expect(await db.select().from(product)).toHaveLength(0);
    expect(await db.select().from(priceEpoch)).toHaveLength(0);
    const [row] = await db.select().from(catalogImportRow);
    expect(row!.included).toBe(false);
    expect(row!.appliedAt).toBeNull();
  });
});
