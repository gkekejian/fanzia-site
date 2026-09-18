import { describe, it, expect } from "vitest";
import {
  buildPoPack,
  toCsv,
  toPrintableHtml,
  suggestSupplierFor,
  type PoPackLineInput,
} from "@/lib/po/pack";
import { logSupplierOverride } from "@/lib/po/overrides";

/**
 * Fixture-only tests for the PO pack generator (design doc §5).
 * No DB, no network — buildPoPack is pure; the audit path is tested
 * against an in-memory fake db handle.
 */

const supplier = { id: "supplier-kp", name: "King Punch" };
const round = { id: "round-oct", ref: "King Punch October order" };

const lines: PoPackLineInput[] = [
  {
    productId: "prod-abyss",
    platformSku: "FZ-JP-ABYSS",
    productName: "Abyss Eye Booster Box (JP)",
    qtyCases: 6,
    qtyUnits: 216,
    internalQtyUnits: 48,
    customerQtyUnits: 168,
  },
  {
    productId: "prod-stellar",
    platformSku: "FZ-CN-STELLAR",
    productName: "Stellar Crystal Booster Box (CN)",
    qtyCases: 4,
    qtyUnits: 144,
    internalQtyUnits: 0,
    customerQtyUnits: 144,
  },
];

describe("buildPoPack", () => {
  it("maps distributor SKUs and UPCs onto line items", () => {
    const pack = buildPoPack({
      round,
      lines,
      supplier,
      distributorSkus: [
        { productId: "prod-abyss", distributorSku: "KP-ABYSS-M5", upc: "111222333444" },
        { productId: "prod-stellar", distributorSku: "KP-STELLAR", upc: null },
      ],
      generatedAt: new Date("2026-09-18T10:00:00Z"),
    });

    expect(pack.roundId).toBe("round-oct");
    expect(pack.supplierId).toBe("supplier-kp");
    expect(pack.items).toHaveLength(2);
    expect(pack.items[0]!.distributorSku).toBe("KP-ABYSS-M5");
    expect(pack.items[0]!.upc).toBe("111222333444");
    expect(pack.items[1]!.distributorSku).toBe("KP-STELLAR");
    expect(pack.items[1]!.upc).toBeNull();
    expect(pack.warnings).toHaveLength(0);
    expect(pack.totals.qtyCases).toBe(10);
    expect(pack.totals.qtyUnits).toBe(360);
  });

  it("flags missing distributor-SKU mappings as warnings, not errors", () => {
    const pack = buildPoPack({
      round,
      lines,
      supplier,
      distributorSkus: [{ productId: "prod-abyss", distributorSku: "KP-ABYSS-M5", upc: null }],
    });

    expect(pack.items).toHaveLength(2);
    const unmapped = pack.items[1]!;
    expect(unmapped.mappingWarning).toBe(true);
    expect(unmapped.distributorSku).toBe("FZ-CN-STELLAR"); // falls back to platform SKU
    expect(pack.warnings).toHaveLength(1);
    expect(pack.warnings[0]).toContain("FZ-CN-STELLAR");
    expect(pack.warnings[0]).toContain("Stellar Crystal");
  });

  it("emits the internal-vs-customer memo split on each line", () => {
    const pack = buildPoPack({ round, lines, supplier, distributorSkus: [] });

    expect(pack.items[0]!.memo).toBe("of which 48 internal vending");
    expect(pack.items[1]!.memo).toBeNull(); // no internal volume, no memo
    expect(pack.totals.internalQtyUnits).toBe(48);
    expect(pack.totals.customerQtyUnits).toBe(312);
  });
});

describe("toCsv", () => {
  it("produces a header plus one row per line with SKU, qty and UPC columns", () => {
    const pack = buildPoPack({
      round,
      lines,
      supplier,
      distributorSkus: [{ productId: "prod-abyss", distributorSku: "KP-ABYSS-M5", upc: "111222333444" }],
    });
    const csv = toCsv(pack);
    const rows = csv.trim().split("\n");

    expect(rows[0]).toBe("SKU,qty_cases,qty_units,UPC,platform_sku,product_name,memo");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("KP-ABYSS-M5");
    expect(rows[1]).toContain("111222333444");
    expect(rows[2]).toContain("FZ-CN-STELLAR"); // unmapped fallback visible
  });

  it("escapes commas and quotes in product names", () => {
    const pack = buildPoPack({
      round,
      lines: [
        {
          productId: "p1",
          platformSku: "FZ-X",
          productName: 'Weird, "Special" Box',
          qtyCases: 1,
          qtyUnits: 36,
          internalQtyUnits: 0,
          customerQtyUnits: 36,
        },
      ],
      supplier,
      distributorSkus: [],
    });
    expect(toCsv(pack)).toContain('"Weird, ""Special"" Box"');
  });
});

describe("toPrintableHtml", () => {
  it("renders a complete printable PO document", () => {
    const pack = buildPoPack({
      round,
      lines,
      supplier,
      distributorSkus: [{ productId: "prod-abyss", distributorSku: "KP-ABYSS-M5", upc: "111222333444" }],
    });
    const html = toPrintableHtml(pack);

    expect(html).toContain("King Punch");
    expect(html).toContain("King Punch October order");
    expect(html).toContain("KP-ABYSS-M5");
    expect(html).toContain("111222333444");
    expect(html).toContain("of which 48 internal vending");
    expect(html).toContain("10 cases / 360 units");
    expect(html).toContain("no auto-submission");
    expect(html).toContain("confirmation #");
    expect(html).toContain("unmapped — platform SKU");
  });

  it("escapes HTML in product names", () => {
    const pack = buildPoPack({
      round,
      lines: [
        {
          productId: "p1",
          platformSku: "FZ-X",
          productName: "<script>alert(1)</script>",
          qtyCases: 1,
          qtyUnits: 36,
          internalQtyUnits: 0,
          customerQtyUnits: 36,
        },
      ],
      supplier,
      distributorSkus: [],
    });
    const html = toPrintableHtml(pack);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("suggestSupplierFor", () => {
  it("falls back to the round supplier when the landed-cost module is absent", async () => {
    const suggestion = await suggestSupplierFor("prod-abyss", 100, "supplier-kp");
    expect(suggestion.supplierId).toBe("supplier-kp");
    expect(suggestion.source).toBe("round_fallback");
  });
});

describe("supplier override audit path", () => {
  it("records an audit entry with before/after when the owner overrides the suggestion", async () => {
    const inserted: unknown[] = [];
    // Minimal fake matching the db.insert(table).values(row) call chain.
    const fakeDb = {
      insert: () => ({
        values: (row: unknown) => {
          inserted.push(row);
          return Promise.resolve();
        },
      }),
    } as never;

    await logSupplierOverride(
      {
        actorUserId: "user-owner",
        actorRole: "owner",
        actorType: "owner",
        roundId: "round-oct",
        productId: "prod-abyss",
        suggestedSupplierId: "supplier-kp",
        suggestedSource: "round_fallback",
        overrideSupplierId: "supplier-hills",
        poPackId: "pack-1",
      },
      fakeDb,
    );

    expect(inserted).toHaveLength(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.action).toBe("po_pack.supplier_override");
    expect(row.entityType).toBe("po_pack");
    expect(row.entityId).toBe("pack-1");
    expect(row.before).toMatchObject({ suggestedSupplierId: "supplier-kp" });
    expect(row.after).toMatchObject({ overrideSupplierId: "supplier-hills" });
  });
});
