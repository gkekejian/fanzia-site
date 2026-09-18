import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import {
  marketPrice,
  productPricingFlag,
  supplierPrice,
} from "@/db/schema/priceIntel";
import { priceEpoch } from "@/db/schema/pricing";
import { product, supplier } from "@/db/schema/catalog";
import { settings } from "@/db/schema/settings";
import { landedUnitCost, type FxRates } from "@/lib/priceIntel/landedCost";
import { loadFxRates, loadSupplierCandidates } from "@/lib/priceIntel/refresh";

/**
 * Owner-only price-intelligence dataset (W5 item 9). Everything here is
 * cost-stack data — supplier identity, supplier prices, landed costs,
 * margins — so this route resolves its actor through requireActor (owner
 * cookie or ai_operator API key with cost_stack:read) and NEVER feeds a
 * buyer-facing DTO. The buyer DTO boundary (lib/catalog/dto.ts) is
 * untouched by this feature.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind === "ai_operator" && !actor.agent.scopes.includes("cost_stack:read")) {
    return NextResponse.json({ error: "cost_stack:read scope required." }, { status: 403 });
  }

  const [products, suppliers, priceRows, marketRows, flagRows, fxRates, candidates, settingsRows] =
    await Promise.all([
      db.select().from(product).orderBy(product.sku),
      db.select().from(supplier),
      db.select().from(supplierPrice).orderBy(desc(supplierPrice.validFrom)),
      db.select().from(marketPrice).orderBy(desc(marketPrice.observedAt)),
      db.select().from(productPricingFlag),
      loadFxRates(db),
      loadSupplierCandidates(db),
      db.select().from(settings),
    ]);

  // Latest wholesale (buyer) price per product from price_epoch.
  const priceEpochRows = await db
    .select()
    .from(priceEpoch)
    .orderBy(desc(priceEpoch.effectiveAt));
  const wholesaleByProduct = new Map<string, { priceMinor: number; currencyCode: string }>();
  for (const r of priceEpochRows) {
    if (!wholesaleByProduct.has(r.productId)) {
      wholesaleByProduct.set(r.productId, {
        priceMinor: r.priceMinor,
        currencyCode: r.currencyCode,
      });
    }
  }

  const latestMarketByProduct = new Map<string, typeof marketRows[number]>();
  for (const r of marketRows) {
    if (!latestMarketByProduct.has(r.productId)) latestMarketByProduct.set(r.productId, r);
  }
  const flagByProduct = new Map(flagRows.map((f) => [f.productId, f.isReal]));
  const nameBySupplier = new Map(suppliers.map((s) => [s.id, s.name]));

  const settingByKey = new Map(settingsRows.map((s) => [s.key, s.value]));
  const marginFloorBps = Number(
    settingByKey.get("price_intel_margin_floor_bps") ??
      settingByKey.get("markup_floor_bps") ??
      2800,
  );

  const priceHistoryByKey = new Map<string, typeof priceRows>();
  for (const r of priceRows) {
    const key = `${r.supplierId}|${r.productId}`;
    const arr = priceHistoryByKey.get(key) ?? [];
    arr.push(r);
    priceHistoryByKey.set(key, arr);
  }

  const productsOut = products.map((p) => {
    const market = latestMarketByProduct.get(p.id) ?? null;
    const isReal = flagByProduct.get(p.id) ?? "estimated";
    const wholesale = wholesaleByProduct.get(p.id) ?? null;

    const supplierRows = (candidates.get(p.id) ?? []).map((c) => {
      const history = priceHistoryByKey.get(`${c.supplierId}|${p.id}`) ?? [];
      const latest = history[0] ?? null;
      const previous = history[1] ?? null;
      const priceChangePct =
        latest && previous && previous.unitPriceMinor !== 0
          ? ((latest.unitPriceMinor - previous.unitPriceMinor) / previous.unitPriceMinor) * 100
          : null;
      let landedCostMinor: number | null = null;
      let landedError: string | null = null;
      try {
        // Reference comparison at qty=1: flat order fees are fully
        // allocated to the unit (conservative, documented in the UI).
        landedCostMinor = landedUnitCost({
          unitPriceMinor: c.unitPriceMinor,
          currency: c.currency,
          fxRates,
          shippingRule: c.shippingRule,
          paymentFeeBps: c.paymentFeeBps,
          qtyUnits: 1,
          caseSize: c.caseSize,
        });
      } catch (err) {
        landedError = (err as Error).message;
      }
      return {
        supplierId: c.supplierId,
        supplierName: nameBySupplier.get(c.supplierId) ?? c.supplierId,
        unitPriceMinor: c.unitPriceMinor,
        currencyCode: c.currency,
        moq: latest?.moq ?? null,
        caseSize: c.caseSize ?? null,
        validFrom: latest?.validFrom?.toISOString() ?? null,
        landedCostMinor,
        landedError,
        priceChangePct,
        history: history.slice(0, 10).map((h) => ({
          unitPriceMinor: h.unitPriceMinor,
          currencyCode: h.currencyCode,
          validFrom: h.validFrom?.toISOString() ?? null,
        })),
      };
    });

    const priced = supplierRows.filter((s) => s.landedCostMinor !== null);
    const cheapest = priced.reduce<
      { supplierId: string; landedCostMinor: number } | null
    >(
      (best, s) =>
        !best || (s.landedCostMinor as number) < best.landedCostMinor
          ? { supplierId: s.supplierId, landedCostMinor: s.landedCostMinor as number }
          : best,
      null,
    );

    const marginVsWholesaleBps =
      cheapest && wholesale && wholesale.currencyCode === "USD" && wholesale.priceMinor > 0
        ? Math.round(
            ((wholesale.priceMinor - cheapest.landedCostMinor) / wholesale.priceMinor) * 10_000,
          )
        : null;
    const marginVsMarketBps =
      cheapest && market && market.marketPriceMinor > 0
        ? Math.round(
            ((market.marketPriceMinor - cheapest.landedCostMinor) /
              market.marketPriceMinor) *
              10_000,
          )
        : null;
    const buyOpportunity =
      market !== null &&
      cheapest !== null &&
      market.marketPriceMinor < cheapest.landedCostMinor;

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      isReal,
      wholesalePriceMinor: wholesale?.priceMinor ?? null,
      market: market
        ? {
            marketPriceMinor: market.marketPriceMinor,
            source: market.source,
            observedAt: market.observedAt?.toISOString() ?? null,
            sampleSize: market.sampleSize,
            confidence: market.confidence,
            sourceUrl: market.sourceUrl,
          }
        : null,
      suppliers: supplierRows,
      cheapest,
      marginVsWholesaleBps,
      marginVsMarketBps,
      buyOpportunity,
    };
  });

  const priceChangeAlerts = productsOut.flatMap((p) =>
    p.suppliers
      .filter((s) => s.priceChangePct !== null && Math.abs(s.priceChangePct!) > 10)
      .map((s) => ({
        sku: p.sku,
        supplierName: s.supplierName,
        priceChangePct: s.priceChangePct,
        validFrom: s.validFrom,
      })),
  );
  const marginFloorBreaches = productsOut
    .filter((p) => p.marginVsWholesaleBps !== null && p.marginVsWholesaleBps! < marginFloorBps)
    .map((p) => ({
      sku: p.sku,
      marginVsWholesaleBps: p.marginVsWholesaleBps,
    }));
  const lowConfidenceMarkets = productsOut
    .filter((p) => p.market?.confidence === "low")
    .map((p) => ({ sku: p.sku, sampleSize: p.market!.sampleSize }));

  return NextResponse.json({
    products: productsOut,
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    fxRates: fxRates as FxRates,
    marginFloorBps,
    priceChangeAlerts,
    marginFloorBreaches,
    lowConfidenceMarkets,
    ebayConfigured: false, // sold data is manual until eBay grants Marketplace Insights (see lib/priceIntel/ebay.ts)
  });
}
