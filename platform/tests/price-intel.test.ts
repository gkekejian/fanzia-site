import { describe, it, expect } from "vitest";
import {
  cheapestSupplierFor,
  FxRateMissingError,
  landedUnitCost,
} from "@/lib/priceIntel/landedCost";
import {
  excludeOutliers,
  iqrBounds,
  median,
  normalizeTitle,
  refreshMarketPrices,
} from "@/lib/priceIntel/refresh";
import type { EbaySoldClient, SoldListing } from "@/lib/priceIntel/ebay";

/* ---------------- landedUnitCost ---------------- */

describe("landedUnitCost", () => {
  it("converts JPY to USD via the owner-set FX rate (minor-based semantics)", () => {
    // ¥1,500 × 0.66 USD-minor-per-JPY = $9.90 → 990 minor, no shipping, no fee.
    const landed = landedUnitCost({
      unitPriceMinor: 1500,
      currency: "JPY",
      fxRates: { JPY: 0.66 },
      shippingRule: null,
      paymentFeeBps: 0,
    });
    expect(landed).toBe(990);
  });

  it("treats USD as rate 1 with no fxRates entry needed", () => {
    const landed = landedUnitCost({
      unitPriceMinor: 14500,
      currency: "USD",
      fxRates: {},
      shippingRule: null,
      paymentFeeBps: 0,
    });
    expect(landed).toBe(14500);
  });

  it("allocates a flat per-order fee across the order's units", () => {
    // $5.00 flat over 10 units → $0.50/unit on top of a $10.00 unit.
    const landed = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: { type: "flat_per_order", amountMinor: 500 },
      paymentFeeBps: 0,
      qtyUnits: 10,
    });
    expect(landed).toBe(1050);
  });

  it("allocates per-case shipping, rounding up partial cases", () => {
    // $12/case of 6: 12 units → 2 cases → $24/12 = $2.00/unit.
    const even = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: { type: "per_case", amountMinor: 1200 },
      paymentFeeBps: 0,
      qtyUnits: 12,
      caseSize: 6,
    });
    expect(even).toBe(1200);

    // 13 units → 3 cases → $36/13 = $2.7692 → 277 minor.
    const partial = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: { type: "per_case", amountMinor: 1200 },
      paymentFeeBps: 0,
      qtyUnits: 13,
      caseSize: 6,
    });
    expect(partial).toBe(1000 + 277);
  });

  it("charges zero shipping under a free_over rule when the threshold is met", () => {
    const landed = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: { type: "free_over", thresholdMinor: 5000 },
      paymentFeeBps: 0,
      qtyUnits: 10,
      subtotalMinorUsd: 10000,
    });
    expect(landed).toBe(1000);
  });

  it("applies payment-processor fees in basis points (PayPal 5% vs Wise 0)", () => {
    const wise = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: null,
      paymentFeeBps: 0,
    });
    const paypal = landedUnitCost({
      unitPriceMinor: 1000,
      currency: "USD",
      fxRates: {},
      shippingRule: null,
      paymentFeeBps: 500,
    });
    expect(wise).toBe(1000);
    expect(paypal).toBe(1050); // 1000 + 5% fee
  });

  it("throws FxRateMissingError when no rate exists for the currency", () => {
    expect(() =>
      landedUnitCost({
        unitPriceMinor: 1500,
        currency: "JPY",
        fxRates: {},
        shippingRule: null,
        paymentFeeBps: 0,
      }),
    ).toThrow(FxRateMissingError);
  });

  it("throws when a per_case rule has no caseSize", () => {
    expect(() =>
      landedUnitCost({
        unitPriceMinor: 1000,
        currency: "USD",
        fxRates: {},
        shippingRule: { type: "per_case", amountMinor: 1200 },
        paymentFeeBps: 0,
        qtyUnits: 12,
      }),
    ).toThrow(/caseSize/);
  });
});

/* ---------------- cheapestSupplierFor ---------------- */

describe("cheapestSupplierFor", () => {
  const fx = { JPY: 0.66 };

  it("picks the supplier with the lowest per-unit landed cost", () => {
    const best = cheapestSupplierFor(
      "prod-1",
      1,
      [
        { supplierId: "king-punch", unitPriceMinor: 1500, currency: "JPY", shippingRule: null, paymentFeeBps: 0 },
        { supplierId: "hills", unitPriceMinor: 1100, currency: "USD", shippingRule: null, paymentFeeBps: 0 },
      ],
      fx,
    );
    expect(best).toEqual({ supplierId: "king-punch", landedCostMinor: 990 });
  });

  it("skips candidates that cannot be priced instead of failing", () => {
    // One candidate lacks an FX rate; the other must still win.
    const best = cheapestSupplierFor(
      "prod-1",
      1,
      [
        { supplierId: "maya", unitPriceMinor: 100, currency: "CNY", shippingRule: null, paymentFeeBps: 0 },
        { supplierId: "hills", unitPriceMinor: 1100, currency: "USD", shippingRule: null, paymentFeeBps: 0 },
      ],
      fx,
    );
    expect(best).toEqual({ supplierId: "hills", landedCostMinor: 1100 });
  });

  it("returns null when no candidate can be priced", () => {
    expect(
      cheapestSupplierFor(
        "prod-1",
        1,
        [{ supplierId: "maya", unitPriceMinor: 100, currency: "CNY", shippingRule: null, paymentFeeBps: 0 }],
        fx,
      ),
    ).toBeNull();
    expect(cheapestSupplierFor("prod-1", 1, [], fx)).toBeNull();
  });

  it("accounts for shipping and payment fees in the comparison", () => {
    // Cheap unit + expensive PayPal fee loses to a slightly pricier unit on Wise.
    const best = cheapestSupplierFor(
      "prod-1",
      1,
      [
        { supplierId: "paypal-supplier", unitPriceMinor: 1000, currency: "USD", shippingRule: null, paymentFeeBps: 500 },
        { supplierId: "wise-supplier", unitPriceMinor: 1040, currency: "USD", shippingRule: null, paymentFeeBps: 0 },
      ],
      {},
    );
    expect(best).toEqual({ supplierId: "wise-supplier", landedCostMinor: 1040 });
  });
});

/* ---------------- stats: median / IQR ---------------- */

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([300, 100, 200])).toBe(200);
  });
  it("averages the two middle values (rounded) for even counts", () => {
    expect(median([100, 200])).toBe(150);
  });
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });
});

describe("iqrBounds / excludeOutliers", () => {
  it("returns null (keep everything) for tiny samples", () => {
    expect(iqrBounds([100, 200, 300])).toBeNull();
    expect(excludeOutliers([100, 200, 300]).removed).toBe(0);
  });

  it("excludes a clear outlier above the upper fence", () => {
    // Q1=100, Q3=102, IQR=2 → upper fence 105; the 500 listing is out.
    const { kept, removed } = excludeOutliers([100, 100, 101, 101, 102, 500]);
    expect(removed).toBe(1);
    expect(kept).toEqual([100, 100, 101, 101, 102]);
  });

  it("excludes a low-ball outlier below the lower fence", () => {
    const { kept, removed } = excludeOutliers([1, 100, 100, 101, 101, 102]);
    expect(removed).toBe(1);
    expect(kept).not.toContain(1);
  });
});

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation to keyword form", () => {
    expect(normalizeTitle("Pokémon: Stellar Crown — Booster Box (Sealed)!")).toBe(
      "pok mon stellar crown booster box sealed",
    );
  });
});

/* ---------------- refreshMarketPrices with a fixture client ---------------- */

function fixtureClient(listings: SoldListing[]): EbaySoldClient {
  return {
    fetchSoldListings: async (upc?: string, query?: string) => {
      void upc;
      void query;
      return listings;
    },
  };
}

function sold(title: string, usdMinor: number, day: number): SoldListing {
  return {
    title,
    soldPriceMinor: usdMinor,
    currency: "USD",
    soldAt: new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`),
    itemUrl: `https://www.ebay.com/itm/${usdMinor}-${day}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeDb = {} as any;

describe("refreshMarketPrices", () => {
  it("stores the outlier-excluded median and flags low confidence for title matches", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([
        sold("Stellar Crown booster box", 4400, 8),
        sold("Stellar Crown booster box", 4500, 9),
        sold("Stellar Crown booster box", 4500, 10),
        sold("Stellar Crown booster box", 4500, 11),
        sold("Stellar Crown booster box", 4600, 12),
        sold("Stellar Crown booster box", 4600, 13),
        sold("Stellar Crown booster box", 9000, 14), // outlier
      ]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Stellar Crown Booster Box" }],
      fxRates: {},
      supplierCandidates: new Map(),
      persist: false,
      delayMs: 0,
    });
    const r = reports[0]!;
    expect(r.medianUsdMinor).toBe(4500);
    expect(r.outliersRemoved).toBe(1);
    expect(r.sampleSize).toBe(6);
    expect(r.confidence).toBe("low"); // title match → never high
    expect(r.matchedBy).toBe("title");
    expect(r.dateRange).toEqual({
      from: "2026-09-08T12:00:00.000Z",
      to: "2026-09-14T12:00:00.000Z",
    });
  });

  it("flags high confidence only for UPC matches with >= 5 inliers", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([
        sold("box", 4500, 1),
        sold("box", 4500, 2),
        sold("box", 4500, 3),
        sold("box", 4500, 4),
        sold("box", 4500, 5),
      ]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Box", upc: "820650813456" }],
      fxRates: {},
      supplierCandidates: new Map(),
      persist: false,
      delayMs: 0,
    });
    expect(reports[0]!.confidence).toBe("high");
    expect(reports[0]!.matchedBy).toBe("upc");
  });

  it("flags a buy opportunity when the eBay median beats the cheapest landed cost", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([
        sold("box", 800, 1),
        sold("box", 820, 2),
        sold("box", 810, 3),
      ]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Box" }],
      fxRates: {},
      supplierCandidates: new Map([
        [
          "prod-1",
          [
            { supplierId: "hills", unitPriceMinor: 1100, currency: "USD", shippingRule: null, paymentFeeBps: 0 },
          ],
        ],
      ]),
      persist: false,
      delayMs: 0,
    });
    const r = reports[0]!;
    expect(r.medianUsdMinor).toBe(810);
    expect(r.cheapestLandedUsdMinor).toBe(1100);
    expect(r.buyOpportunity).toBe(true);
  });

  it("does not flag a buy opportunity when suppliers are cheaper than eBay", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([sold("box", 2000, 1), sold("box", 2100, 2), sold("box", 2050, 3)]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Box" }],
      fxRates: {},
      supplierCandidates: new Map([
        [
          "prod-1",
          [
            { supplierId: "hills", unitPriceMinor: 1100, currency: "USD", shippingRule: null, paymentFeeBps: 0 },
          ],
        ],
      ]),
      persist: false,
      delayMs: 0,
    });
    expect(reports[0]!.buyOpportunity).toBe(false);
  });

  it("skips listings in currencies with no FX rate and reports below-minSample honestly", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([
        { ...sold("box", 800, 1), currency: "EUR" }, // no EUR rate → dropped
        sold("box", 810, 2),
      ]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Box" }],
      fxRates: {},
      supplierCandidates: new Map(),
      persist: false,
      delayMs: 0,
      minSample: 3,
    });
    const r = reports[0]!;
    expect(r.converted).toBe(1);
    expect(r.medianUsdMinor).toBeNull();
    expect(r.skipped).toContain("below minSample");
  });

  it("converts foreign-currency sold prices to USD via fxRates", async () => {
    const reports = await refreshMarketPrices({
      db: fakeDb,
      client: fixtureClient([
        { ...sold("box", 1500, 1), currency: "JPY" }, // ¥1500 × 0.66 = $9.90
        { ...sold("box", 1600, 2), currency: "JPY" }, // ¥1600 × 0.66 = $10.56
      ]),
      products: [{ id: "prod-1", sku: "PK-001", name: "Box" }],
      fxRates: { JPY: 0.66 },
      supplierCandidates: new Map(),
      persist: false,
      delayMs: 0,
      minSample: 1,
    });
    expect(reports[0]!.medianUsdMinor).toBe(1023); // round((990+1056)/2)
  });
});
