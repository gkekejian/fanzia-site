import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  catalogImport,
  catalogImportRow,
  product,
  sourcingRoute,
  priceEpoch,
  sourceCheck,
  auditLog,
  agentProposal,
} from "@/db/schema";
import {
  stageCatalogImport,
  approveCatalogImport,
  rejectCatalogImport,
  publishCatalogImport,
  setCatalogImportRowIncluded,
  getCatalogImportWithRows,
  ValidationError,
} from "@/lib/catalog/import/service";
import {
  seedCurrency,
  makeOwner,
  makeAgent,
  IMPORT_HEADERS,
  csvRow,
} from "./catalogFixtures";

/**
 * Build prompt §11: CSV/XLSX import is upload → parse → stage → diff →
 * owner approves the diff → publish writes a new price epoch, only after
 * approval. Test gates #14 (re-import is a no-op) and #15 (no publish
 * without a reviewed diff).
 */
const row = (
  sku: string,
  overrides: Record<string, string | number | undefined> = {},
): string =>
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
    overrides.markup_bps_override,
    overrides.stock_observed ?? 20,
    "member_page",
    "observed",
    "",
  ]);

const csvOf = (...rows: string[]) => [IMPORT_HEADERS, ...rows].join("\n");

describe("staged import with reviewable diff", () => {
  it("staging writes only import tables — nothing goes live", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-001"), row("PIPE-002"))) },
      db,
    );
    expect(imp.status).toBe("staged");
    expect(imp.rowCount).toBe(2);

    const { rows } = await getCatalogImportWithRows(imp.id, db);
    expect(rows.map((r) => r.diffType).sort()).toEqual(["add", "add"]);
    expect(rows.every((r) => r.included)).toBe(true);
    expect(rows.every((r) => r.appliedAt === null)).toBe(true);

    // Live catalog untouched by staging.
    expect(await db.select().from(product)).toHaveLength(0);
    expect(await db.select().from(priceEpoch)).toHaveLength(0);
    expect(await db.select().from(sourceCheck)).toHaveLength(0);
    expect(await db.select().from(sourcingRoute)).toHaveLength(0);

    // Staging itself is audited.
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "catalog_import.staged"));
    expect(audits).toHaveLength(1);
  });

  it("publishing without approval is refused and writes nothing (test gate #15)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-010"))) },
      db,
    );
    await expect(publishCatalogImport({ importId: imp.id, actor }, db)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(product)).toHaveLength(0);

    const [still] = await db.select().from(catalogImport).where(eq(catalogImport.id, imp.id));
    expect(still!.status).toBe("staged");
  });

  it("approve → publish writes products, routes, price epochs, and source checks", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor, userId } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-020"))) },
      db,
    );
    const approved = await approveCatalogImport({ importId: imp.id, actor }, db);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(userId);

    const result = await publishCatalogImport({ importId: imp.id, actor }, db);
    expect(result.executed).toBe(true);

    const products = await db.select().from(product);
    expect(products).toHaveLength(1);
    expect(products[0]!.sku).toBe("PIPE-020");
    expect(products[0]!.status).toBe("active");

    const routes = await db.select().from(sourcingRoute);
    expect(routes).toHaveLength(1);

    const epochs = await db.select().from(priceEpoch);
    expect(epochs).toHaveLength(1);
    expect(epochs[0]!.costMinor).toBe(10000);
    expect(epochs[0]!.markupBps).toBe(3500); // import default
    expect(epochs[0]!.priceMinor).toBe(13500);
    expect(epochs[0]!.publishedFromImportId).toBe(imp.id);

    const checks = await db.select().from(sourceCheck);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.stockObserved).toBe(20);
    expect(checks[0]!.confidence).toBe("observed");

    const [published] = await db.select().from(catalogImport).where(eq(catalogImport.id, imp.id));
    expect(published!.status).toBe("published");
    expect(published!.publishedBy).toBe(userId);

    const { rows } = await getCatalogImportWithRows(imp.id, db);
    expect(rows.every((r) => r.appliedAt !== null)).toBe(true);

    // Audit covers the full lifecycle.
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("catalog_import.staged");
    expect(actions).toContain("catalog_import.approved");
    expect(actions).toContain("catalog_import.publish");
  });

  it("approve cannot be skipped and publish cannot run twice", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-030"))) },
      db,
    );
    await approveCatalogImport({ importId: imp.id, actor }, db);
    await expect(approveCatalogImport({ importId: imp.id, actor }, db)).rejects.toThrow(
      "Only a staged import can be approved",
    );

    await publishCatalogImport({ importId: imp.id, actor }, db);
    await expect(publishCatalogImport({ importId: imp.id, actor }, db)).rejects.toThrow(
      "Only an approved import can be published",
    );
  });

  it("re-importing the same file is a no-op: every row is unchanged and no new epochs are written (test gate #14)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const csv = csvOf(row("PIPE-040"));
    const imp1 = await stageCatalogImport({ actor, filename: "prices.csv", buffer: Buffer.from(csv) }, db);
    await approveCatalogImport({ importId: imp1.id, actor }, db);
    await publishCatalogImport({ importId: imp1.id, actor }, db);
    expect(await db.select().from(priceEpoch)).toHaveLength(1);

    const imp2 = await stageCatalogImport({ actor, filename: "prices.csv", buffer: Buffer.from(csv) }, db);
    const { rows } = await getCatalogImportWithRows(imp2.id, db);
    expect(rows.map((r) => r.diffType)).toEqual(["unchanged"]);

    await approveCatalogImport({ importId: imp2.id, actor }, db);
    await publishCatalogImport({ importId: imp2.id, actor }, db);
    // Still exactly one epoch and one product: no duplicates.
    expect(await db.select().from(priceEpoch)).toHaveLength(1);
    expect(await db.select().from(product)).toHaveLength(1);
  });

  it("a price change writes a NEW epoch — prior values are preserved (append-only)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp1 = await stageCatalogImport(
      { actor, filename: "v1.csv", buffer: Buffer.from(csvOf(row("PIPE-050"))) },
      db,
    );
    await approveCatalogImport({ importId: imp1.id, actor }, db);
    await publishCatalogImport({ importId: imp1.id, actor }, db);

    const imp2 = await stageCatalogImport(
      {
        actor,
        filename: "v2.csv",
        buffer: Buffer.from(csvOf(row("PIPE-050", { markup_bps_override: 4000 }))),
      },
      db,
    );
    const { rows } = await getCatalogImportWithRows(imp2.id, db);
    expect(rows[0]!.diffType).toBe("price_change");

    await approveCatalogImport({ importId: imp2.id, actor }, db);
    await publishCatalogImport({ importId: imp2.id, actor }, db);

    const epochs = await db.select().from(priceEpoch);
    expect(epochs).toHaveLength(2);
    expect(epochs.map((e) => e.markupBps).sort()).toEqual([3500, 4000]);
  });

  it("a product missing from the file is flagged, never silently deactivated", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp1 = await stageCatalogImport(
      { actor, filename: "full.csv", buffer: Buffer.from(csvOf(row("PIPE-060"), row("PIPE-061"))) },
      db,
    );
    await approveCatalogImport({ importId: imp1.id, actor }, db);
    await publishCatalogImport({ importId: imp1.id, actor }, db);

    // Second file drops PIPE-061.
    const imp2 = await stageCatalogImport(
      { actor, filename: "partial.csv", buffer: Buffer.from(csvOf(row("PIPE-060"))) },
      db,
    );
    const { rows } = await getCatalogImportWithRows(imp2.id, db);
    const missing = rows.find((r) => r.diffType === "missing");
    expect(missing).toBeDefined();
    expect(missing!.included).toBe(false); // owner must opt in to discontinuing

    await approveCatalogImport({ importId: imp2.id, actor }, db);
    await publishCatalogImport({ importId: imp2.id, actor }, db);

    const [stillActive] = await db.select().from(product).where(eq(product.sku, "PIPE-061"));
    expect(stillActive!.status).toBe("active");
  });

  it("reviewers can exclude a row before approval; excluded rows are not published", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-070"), row("PIPE-071"))) },
      db,
    );
    const { rows } = await getCatalogImportWithRows(imp.id, db);
    const toExclude = rows.find((r) => JSON.stringify(r.stagedData).includes("PIPE-071"))!;
    await setCatalogImportRowIncluded({ importId: imp.id, rowId: toExclude.id, included: false, actor }, db);

    await approveCatalogImport({ importId: imp.id, actor }, db);
    await publishCatalogImport({ importId: imp.id, actor }, db);

    const products = await db.select().from(product);
    expect(products.map((p) => p.sku)).toEqual(["PIPE-070"]);
  });

  it("rows cannot be toggled after approval (the reviewed diff is locked)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-080"))) },
      db,
    );
    await approveCatalogImport({ importId: imp.id, actor }, db);
    const { rows } = await getCatalogImportWithRows(imp.id, db);
    await expect(
      setCatalogImportRowIncluded({ importId: imp.id, rowId: rows[0]!.id, included: false, actor }, db),
    ).rejects.toThrow("only be toggled while the import is staged");
  });

  it("rejecting an import blocks publish", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const imp = await stageCatalogImport(
      { actor, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-090"))) },
      db,
    );
    await rejectCatalogImport({ importId: imp.id, actor }, db);
    await expect(publishCatalogImport({ importId: imp.id, actor }, db)).rejects.toThrow(
      "Only an approved import can be published",
    );
    expect(await db.select().from(product)).toHaveLength(0);
  });

  it("invalid rows are staged as invalid and can never be included", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    // A row with an invalid condition enum: present, but fails validation.
    const bad = csvRow([
      "BAD-001",
      "Bad Box",
      "Japanese",
      "Japan",
      "loose",
      30,
      5,
      "released",
      "Invalid condition value.",
      "Test Supplier Co",
      "import",
      "USD",
      10000,
      "",
      "",
      "",
      "",
      "",
    ]);
    const imp = await stageCatalogImport(
      { actor, filename: "bad.csv", buffer: Buffer.from([IMPORT_HEADERS, bad].join("\n")) },
      db,
    );
    const { rows } = await getCatalogImportWithRows(imp.id, db);
    expect(rows[0]!.diffType).toBe("invalid");
    expect(rows[0]!.included).toBe(false);
    expect(rows[0]!.validationErrors).not.toBeNull();
  });

  it("an ai_operator cannot publish directly — it creates an agent_proposal instead (test gate #32)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor: owner } = await makeOwner(db);
    const { actor: agent } = await makeAgent(db, ["read"]);

    const imp = await stageCatalogImport(
      { actor: owner, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-100"))) },
      db,
    );
    await approveCatalogImport({ importId: imp.id, actor: owner }, db);

    const result = await publishCatalogImport({ importId: imp.id, actor: agent }, db);
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.proposalId).toBeTruthy();

    // Nothing written: the proposal queue holds it for a human owner.
    expect(await db.select().from(product)).toHaveLength(0);
    expect(await db.select().from(priceEpoch)).toHaveLength(0);
    const proposals = await db.select().from(agentProposal);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.proposedAction).toBe("catalog_import.publish");

    const [still] = await db.select().from(catalogImport).where(eq(catalogImport.id, imp.id));
    expect(still!.status).toBe("approved");
  });

  it("an XLSX workbook stages through the same pipeline as CSV", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);

    const XLSX = await import("xlsx");
    const headers = IMPORT_HEADERS.split(",");
    const values = row("PIPE-XLSX").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((v) => v.replace(/^"|"$/g, ""));
    const sheet = XLSX.utils.aoa_to_sheet([headers, values]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Catalog");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const imp = await stageCatalogImport({ actor, filename: "prices.xlsx", buffer }, db);
    expect(imp.fileFormat).toBe("xlsx");
    const { rows } = await getCatalogImportWithRows(imp.id, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diffType).toBe("add");

    await approveCatalogImport({ importId: imp.id, actor }, db);
    await publishCatalogImport({ importId: imp.id, actor }, db);
    expect(await db.select().from(product)).toHaveLength(1);
  });

  it("staging/approve are not restricted: ai_operator may stage and approve, publish stays gated", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor: agent } = await makeAgent(db, ["read"]);

    const imp = await stageCatalogImport(
      { actor: agent, filename: "prices.csv", buffer: Buffer.from(csvOf(row("PIPE-110"))) },
      db,
    );
    expect(imp.status).toBe("staged");
    const approved = await approveCatalogImport({ importId: imp.id, actor: agent }, db);
    expect(approved.status).toBe("approved");
    // Live tables still untouched — only publish writes them, and that is gated.
    expect(await db.select().from(product)).toHaveLength(0);
  });
});
