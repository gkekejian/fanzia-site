import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { product, priceEpoch } from "@/db/schema";
import {
  stageCatalogImport,
  approveCatalogImport,
  publishCatalogImport,
  getCatalogImportWithRows,
} from "@/lib/catalog/import/service";
import { getMemberCatalog } from "@/lib/catalog/queries";
import { seedCurrency, makeOwner, IMPORT_HEADERS, csvRow } from "./catalogFixtures";

/**
 * The optional `msrp` import column (dollar amount, e.g. 24.99) flows
 * rowSchema → stagedData → publish → product.msrp_minor, and from there
 * into the member DTO's buyer-margin fields. Blank means "no change
 * proposed" — never "clear the MSRP". The pipeline had a clean column
 * hook (rowSchema + stagedData), so no hacking was needed.
 */
const HEADERS = `${IMPORT_HEADERS},msrp`;

const row = (sku: string, msrp: string | number | undefined): string =>
  csvRow([
    sku,
    `${sku} Booster Box`,
    "Japanese",
    "Japan",
    "sealed",
    30,
    5,
    "released",
    `Fixture product ${sku}.`,
    "Test Supplier Co",
    "import",
    "USD",
    10000,
    undefined, // markup_bps_override
    20, // stock_observed
    "member_page",
    "observed",
    "",
    msrp,
  ]);

const csvOf = (...rows: string[]) => [HEADERS, ...rows].join("\n");

async function stageApprovePublish(db: Parameters<typeof makeOwner>[0], csv: string) {
  const { actor } = await makeOwner(db);
  const imp = await stageCatalogImport({ actor, filename: "msrp.csv", buffer: Buffer.from(csv) }, db);
  await approveCatalogImport({ importId: imp.id, actor }, db);
  await publishCatalogImport({ importId: imp.id, actor }, db);
  return getCatalogImportWithRows(imp.id, db);
}

describe("msrp import column", () => {
  it("publishes msrp_minor onto new products and exposes buyer margin", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);

    await stageApprovePublish(db, csvOf(row("MSRP-001", "199.99")));

    const [p] = await db.select().from(product).where(eq(product.sku, "MSRP-001"));
    expect(p!.msrpMinor).toBe(19999);

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.msrpMinor).toBe(19999);
    // price = 10000 * 1.35 = 13500; buyer margin = (19999 - 13500) / 19999.
    expect(catalog[0]!.priceMinor).toBe(13500);
    expect(catalog[0]!.marginMinor).toBe(19999 - 13500);
    expect(catalog[0]!.marginBps).toBeGreaterThan(0);
  });

  it("blank msrp leaves an existing MSRP untouched (no msrp_change diff)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);

    await stageApprovePublish(db, csvOf(row("MSRP-010", "30.00")));
    const { rows } = await stageApprovePublish(db, csvOf(row("MSRP-010", undefined)));
    expect(rows.map((r) => r.diffType)).toEqual(["unchanged"]);

    const [p] = await db.select().from(product).where(eq(product.sku, "MSRP-010"));
    expect(p!.msrpMinor).toBe(3000);
  });

  it("an msrp-only change diffs as msrp_change and updates without a new price epoch", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);

    await stageApprovePublish(db, csvOf(row("MSRP-020", "30.00")));
    const epochsBefore = await db.select().from(priceEpoch);

    const { rows } = await stageApprovePublish(db, csvOf(row("MSRP-020", "35.50")));
    expect(rows.map((r) => r.diffType)).toEqual(["msrp_change"]);

    const [p] = await db.select().from(product).where(eq(product.sku, "MSRP-020"));
    expect(p!.msrpMinor).toBe(3550);
    // MSRP is reference data, not a price: no new price epoch.
    expect(await db.select().from(priceEpoch)).toHaveLength(epochsBefore.length);
  });

  it("an invalid msrp fails the row with a clear message", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "msrp-bad.csv", buffer: Buffer.from(csvOf(row("MSRP-030", "abc"))) },
      db,
    );
    const { rows } = await getCatalogImportWithRows(imp.id, db);
    expect(rows[0]!.diffType).toBe("invalid");
    expect(rows[0]!.included).toBe(false);
    expect(JSON.stringify(rows[0]!.validationErrors)).toContain("msrp");
  });

  it("no msrp column at all behaves as before (null msrp, null margin)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const noMsrpRow = csvRow([
      "MSRP-040", "MSRP-040 Booster Box", "Japanese", "Japan", "sealed", 30, 5, "released",
      "Fixture product MSRP-040.", "Test Supplier Co", "import", "USD", 10000, undefined, 20,
      "member_page", "observed", "",
    ]);
    const imp = await stageCatalogImport(
      { actor, filename: "no-msrp.csv", buffer: Buffer.from([IMPORT_HEADERS, noMsrpRow].join("\n")) },
      db,
    );
    await approveCatalogImport({ importId: imp.id, actor }, db);
    await publishCatalogImport({ importId: imp.id, actor }, db);

    const catalog = await getMemberCatalog(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.msrpMinor).toBeNull();
    expect(catalog[0]!.marginMinor).toBeNull();
    expect(catalog[0]!.marginBps).toBeNull();
  });
});
