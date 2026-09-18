import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { EbayNotConfigured, getEbaySoldClient } from "@/lib/priceIntel/ebay";
import { refreshAllMarketPrices } from "@/lib/priceIntel/refresh";

/**
 * Weekly market-price refresh (wired to Vercel Cron by the coordinator —
 * do not add the schedule here). CRON_SECRET-protected like the other
 * cron routes: without a matching secret it answers 401 and does nothing.
 *
 * Rate-limit discipline: this is the ONLY place eBay is ever called —
 * once per week per product, results cached in market_price rows. No
 * page-view path touches eBay. Until the Marketplace Insights scope is
 * granted (see lib/priceIntel/ebay.ts), the client throws
 * EbayNotConfigured and this route answers with skipped:'ebay_not_configured'
 * so the cron stays green and owners keep entering market prices manually.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reports = await refreshAllMarketPrices(db, getEbaySoldClient());
    const stored = reports.filter((r) => r.medianUsdMinor !== null).length;
    const buyOpportunities = reports.filter((r) => r.buyOpportunity);
    await recordAudit(
      {
        actorType: "system",
        action: "price_refresh.completed",
        entityType: "market_price",
        after: {
          products: reports.length,
          stored,
          buyOpportunities: buyOpportunities.map((r) => ({
            sku: r.sku,
            ebayMedianUsdMinor: r.medianUsdMinor,
            cheapestLandedUsdMinor: r.cheapestLandedUsdMinor,
          })),
        },
      },
      db,
    );
    return NextResponse.json({
      ok: true,
      products: reports.length,
      stored,
      buyOpportunities: buyOpportunities.map((r) => r.sku),
    });
  } catch (err) {
    if (err instanceof EbayNotConfigured) {
      await recordAudit(
        {
          actorType: "system",
          action: "price_refresh.skipped",
          entityType: "market_price",
          after: { reason: "ebay_not_configured — manual market-price entry in use" },
        },
        db,
      );
      return NextResponse.json({
        ok: true,
        skipped: "ebay_not_configured",
        message: "eBay sold data unavailable on the free tier; market prices are entered manually.",
      });
    }
    throw err;
  }
}
