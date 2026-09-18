import type { PgDatabase } from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import {
  fxRate,
  marketPrice,
  supplierPrice,
  supplierShippingRule,
} from "@/db/schema/priceIntel";
import { product } from "@/db/schema/catalog";
import { distributorSku } from "@/db/schema/distributor";
import { currency } from "@/db/schema/currency";
import {
  cheapestSupplierFor,
  type FxRates,
  type SupplierCandidatePrice,
} from "./landedCost";
import type { EbaySoldClient, SoldListing } from "./ebay";
import { EbayNotConfigured } from "./ebay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested, no DB)                                   */
/* ------------------------------------------------------------------ */

/** Median of a non-empty array. Returns 0 for an empty array. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Tukey IQR fence. Returns null when there are fewer than 4 samples —
 * IQR on tiny samples is noise, so small sets keep every point.
 */
export function iqrBounds(values: number[]): { lower: number; upper: number } | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, half);
  const upperHalf = sorted.slice(sorted.length % 2 === 1 ? half + 1 : half);
  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

/** Removes values outside the IQR fence; keeps everything when n < 4. */
export function excludeOutliers(values: number[]): {
  kept: number[];
  removed: number;
} {
  const bounds = iqrBounds(values);
  if (!bounds) return { kept: [...values], removed: 0 };
  const kept = values.filter((v) => v >= bounds.lower && v <= bounds.upper);
  return { kept, removed: values.length - kept.length };
}

/** Normalizes a product title into an eBay keyword query. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type RefreshProduct = {
  id: string;
  sku: string;
  name: string;
  /** UPC/GTIN when mapped (distributor_sku.upc); else title matching. */
  upc?: string | null;
};

export type ProductRefreshReport = {
  productId: string;
  sku: string;
  matchedBy: "upc" | "title";
  fetched: number;
  converted: number;
  outliersRemoved: number;
  sampleSize: number;
  medianUsdMinor: number | null;
  confidence: "high" | "low";
  /** True when eBay median < cheapest supplier landed cost. */
  buyOpportunity: boolean;
  cheapestLandedUsdMinor: number | null;
  dateRange: { from: string; to: string } | null;
  skipped: string | null;
};

export type RefreshMarketPricesInput = {
  /** Inject a DB handle in tests; defaults to the real connection. */
  db?: AnyDb;
  client: EbaySoldClient;
  products: RefreshProduct[];
  /** Foreign→USD rates for sold-listing currency normalization
   * (minor-based FxRates semantics — USD minor per 1 foreign minor unit). */
  fxRates: FxRates;
  /**
   * Pre-computed supplier candidates per product id for the
   * buy-opportunity check. In production, build this with
   * loadSupplierCandidates(); in tests, pass fixtures.
   */
  supplierCandidates: Map<string, SupplierCandidatePrice[]>;
  minSample?: number;
  now?: Date;
  /** Politeness delay between products (ms). Default 1000. */
  delayMs?: number;
  /** Persist market_price rows. Default true; false = dry run. */
  persist?: boolean;
};

/**
 * Weekly market-price refresh. Rate-limit discipline: this runs ONCE per
 * scheduled weekly cron (app/api/cron/price-refresh), results are cached
 * in market_price rows, and nothing in the buyer-facing request path ever
 * calls eBay. Per product: fetch solds → FX-normalize to USD minor →
 * exclude IQR outliers → store median + sampleSize + date range.
 *
 * Confidence: 'high' only when matched by UPC with ≥5 inlier samples;
 * anything else is 'low' and is NEVER silently accepted — low-confidence
 * rows carry "NEEDS OWNER REVIEW" in notes and the admin UI surfaces them
 * in a review banner.
 */
export async function refreshMarketPrices(
  input: RefreshMarketPricesInput,
): Promise<ProductRefreshReport[]> {
  const {
    db = defaultDb,
    client,
    products,
    fxRates,
    supplierCandidates,
    minSample = 3,
    now = new Date(),
    delayMs = 1000,
    persist = true,
  } = input;

  const reports: ProductRefreshReport[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    const matchedBy = p.upc ? ("upc" as const) : ("title" as const);
    let listings: SoldListing[];
    try {
      listings =
        matchedBy === "upc"
          ? await client.fetchSoldListings(p.upc!, undefined)
          : await client.fetchSoldListings(undefined, normalizeTitle(p.name));
    } catch (err) {
      if (err instanceof EbayNotConfigured) throw err;
      reports.push({
        productId: p.id,
        sku: p.sku,
        matchedBy,
        fetched: 0,
        converted: 0,
        outliersRemoved: 0,
        sampleSize: 0,
        medianUsdMinor: null,
        confidence: "low",
        buyOpportunity: false,
        cheapestLandedUsdMinor: null,
        dateRange: null,
        skipped: `fetch failed: ${(err as Error).message}`,
      });
      continue;
    }

    // FX-normalize every sold price to USD minor. fxRates is
    // minor-based (USD minor per 1 foreign minor unit — see FxRates).
    const usdPrices: number[] = [];
    let converted = 0;
    for (const l of listings) {
      const rate = l.currency === "USD" ? 1 : fxRates[l.currency];
      if (rate === undefined || !Number.isFinite(rate) || rate <= 0) continue;
      usdPrices.push(Math.round(l.soldPriceMinor * rate));
      converted++;
    }

    const { kept, removed } = excludeOutliers(usdPrices);
    const medianUsdMinor = kept.length >= minSample ? median(kept) : null;
    const confidence: "high" | "low" =
      matchedBy === "upc" && kept.length >= 5 ? "high" : "low";

    // Buy-opportunity check: eBay median below cheapest supplier landed
    // cost (per-unit comparison, qty = 1).
    const candidates = supplierCandidates.get(p.id) ?? [];
    const cheapest = cheapestSupplierFor(p.id, 1, candidates, fxRates);
    const cheapestLandedUsdMinor = cheapest ? cheapest.landedCostMinor : null;
    const buyOpportunity =
      medianUsdMinor !== null &&
      cheapestLandedUsdMinor !== null &&
      medianUsdMinor < cheapestLandedUsdMinor;

    let dateRange: { from: string; to: string } | null = null;
    if (listings.length > 0) {
      const times = listings
        .map((l) => l.soldAt.getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (times.length > 0) {
        dateRange = {
          from: new Date(times[0]!).toISOString(),
          to: new Date(times[times.length - 1]!).toISOString(),
        };
      }
    }

    if (medianUsdMinor !== null && persist) {
      const notesParts = [
        `range ${dateRange ? `${dateRange.from}..${dateRange.to}` : "unknown"}`,
        `${removed} outlier(s) excluded via IQR`,
        matchedBy === "upc" ? `matched by UPC ${p.upc}` : "matched by normalized title",
      ];
      if (confidence === "low") notesParts.push("NEEDS OWNER REVIEW");
      await db.insert(marketPrice).values({
        productId: p.id,
        marketPriceMinor: medianUsdMinor,
        source: "ebay_sold",
        observedAt: now,
        sampleSize: kept.length,
        confidence,
        notes: notesParts.join("; "),
      });
    }

    reports.push({
      productId: p.id,
      sku: p.sku,
      matchedBy,
      fetched: listings.length,
      converted,
      outliersRemoved: removed,
      sampleSize: kept.length,
      medianUsdMinor,
      confidence,
      buyOpportunity,
      cheapestLandedUsdMinor,
      dateRange,
      skipped:
        medianUsdMinor === null
          ? `below minSample (${kept.length} < ${minSample})`
          : null,
    });

    if (delayMs > 0 && i < products.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return reports;
}

/* ------------------------------------------------------------------ */
/* DB loaders for the production cron path                             */
/* ------------------------------------------------------------------ */

/** Latest owner-set FX rate per from→USD pair, converted to FxRates
 * semantics (USD minor per 1 foreign minor unit) using the currency
 * table's exponents. E.g. a human-entered JPY→USD rate of 0.0066 becomes
 * 0.66 (¥1 = $0.0066 = 0.66 USD cents). */
export async function loadFxRates(db: AnyDb = defaultDb): Promise<FxRates> {
  const [rows, currencies] = await Promise.all([
    db.select().from(fxRate).orderBy(desc(fxRate.setAt)),
    db.select().from(currency),
  ]);
  const exponentByCode = new Map(currencies.map((c) => [c.code, c.exponent]));
  const usdExp = exponentByCode.get("USD") ?? 2;
  const out: FxRates = {};
  for (const r of rows) {
    if (r.toCurrency !== "USD") continue; // landed-cost engine normalizes to USD
    if (out[r.fromCurrency] !== undefined) continue;
    const fromExp = exponentByCode.get(r.fromCurrency);
    if (fromExp === undefined) continue;
    out[r.fromCurrency] = Number(r.rate) * Math.pow(10, usdExp - fromExp);
  }
  return out;
}

type DbShippingRuleRow = typeof supplierShippingRule.$inferSelect;

/** Latest supplier price per supplier×product, joined to shipping rules. */
export async function loadSupplierCandidates(
  db: AnyDb = defaultDb,
): Promise<Map<string, SupplierCandidatePrice[]>> {
  const priceRows = await db
    .select()
    .from(supplierPrice)
    .orderBy(desc(supplierPrice.validFrom));
  const ruleRows = await db.select().from(supplierShippingRule);
  const rulesBySupplier = new Map<string, DbShippingRuleRow>(
    ruleRows.map((r) => [r.supplierId, r]),
  );

  const latest = new Map<string, typeof priceRows[number]>();
  for (const row of priceRows) {
    const key = `${row.supplierId}|${row.productId}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const out = new Map<string, SupplierCandidatePrice[]>();
  for (const row of latest.values()) {
    const rule = rulesBySupplier.get(row.supplierId);
    const candidate: SupplierCandidatePrice = {
      supplierId: row.supplierId,
      unitPriceMinor: row.unitPriceMinor,
      currency: row.currencyCode,
      shippingRule: rule
        ? rule.ruleType === "free_over"
          ? { type: "free_over", thresholdMinor: Number(rule.thresholdMinor ?? 0) }
          : {
              type: rule.ruleType,
              amountMinor: Number(rule.amountMinor ?? 0),
            }
        : null,
      caseSize: row.caseSize,
      paymentFeeBps: rule?.paymentFeeBps ?? 0,
    };
    const arr = out.get(row.productId) ?? [];
    arr.push(candidate);
    out.set(row.productId, arr);
  }
  return out;
}

export type RefreshableProduct = {
  id: string;
  sku: string;
  name: string;
  upc: string | null;
};

/** Active, publicly visible products with their first mapped UPC (if any). */
export async function loadRefreshableProducts(
  db: AnyDb = defaultDb,
): Promise<RefreshableProduct[]> {
  const products = await db.select().from(product);
  const skuRows = await db.select().from(distributorSku);
  const upcByProduct = new Map<string, string>();
  for (const s of skuRows) {
    if (s.upc && !upcByProduct.has(s.productId)) upcByProduct.set(s.productId, s.upc);
  }
  return products
    .filter((p) => p.status === "active" && p.publiclyVisible)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      upc: upcByProduct.get(p.id) ?? null,
    }));
}

/**
 * Full production entry for the weekly cron: loads products, FX, and
 * supplier candidates from the DB, then runs refreshMarketPrices.
 * Propagates EbayNotConfigured so the cron route can answer "manual mode"
 * instead of erroring.
 */
export async function refreshAllMarketPrices(
  db: AnyDb,
  client: EbaySoldClient,
  opts?: { now?: Date },
): Promise<ProductRefreshReport[]> {
  const [products, fxRates, supplierCandidates] = await Promise.all([
    loadRefreshableProducts(db),
    loadFxRates(db),
    loadSupplierCandidates(db),
  ]);
  return refreshMarketPrices({
    db,
    client,
    products: products.map((p) => ({ ...p, upc: p.upc ?? undefined })),
    fxRates,
    supplierCandidates,
    now: opts?.now,
  });
}
