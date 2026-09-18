/**
 * eBay sold-listing market data (W5). Research current as of 2026-09-18 —
 * see the report below before wiring a real client.
 *
 * ## Research findings
 *
 * The ONLY official eBay endpoint that exposes sold/completed listing
 * prices is the **Buy Marketplace Insights API**:
 *   GET https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search
 * which returns `itemSales[]` with `lastSoldPrice` (value + currency),
 * `lastSoldDate`, and `totalSoldQuantity`.
 *
 * BUT: Marketplace Insights is a **Limited Release / gated scope**
 * (`buy.marketplace.insights`). It requires a separate application to eBay
 * and is routinely denied to small developers — a documented denial on
 * 2026-07-15 (eBay ticket 260713-000007) calls it "generally reserved for
 * eBay's approved partners only." Without approval the token mint returns
 * `invalid_scope`.
 *
 * What the free tier DOES give (OAuth app token via client-credentials
 * grant, ~5,000 Browse calls/day, no user login needed):
 * - Browse API `/buy/browse/v1/item_summary/search` — ACTIVE listings
 *   only. No sold data, no completed data.
 * - The legacy Finding API `findCompletedItems` (which once exposed sold
 *   data) is deprecated/sunset — do not build on it.
 *
 * CONCLUSION: on the free tier, eBay does NOT expose sold prices via any
 * official API. So this module exports a stub client that throws
 * EbayNotConfigured, and the platform relies on manual market-price entry
 * (app/api/admin/price-intel/market) until eBay grants the Marketplace
 * Insights scope. The interface below stays stable so a real client can be
 * dropped in later with no changes to refresh.ts.
 *
 * If access IS granted later: mint an OAuth client-credentials token with
 * the `https://api.ebay.com/oauth/api_scope/buy.marketplace.insights`
 * scope, implement EbaySoldClient against item_sales/search (q = UPC or
 * keywords, limit ≤ 200), map lastSoldPrice → soldPriceMinor using the
 * currency exponent, and export it from getEbaySoldClient when
 * EBAY_MARKETPLACE_INSIGHTS_GRANTED=1.
 *
 * NEVER HTML-scrape eBay and never use George's personal eBay login —
 * both are out of scope by explicit decision (2026-09-18).
 */

export type SoldListing = {
  title: string;
  /** Sold price in minor currency units (e.g. cents). */
  soldPriceMinor: number;
  /** ISO 4217 currency code of the sold price. */
  currency: string;
  soldAt: Date;
  itemUrl: string;
};

export interface EbaySoldClient {
  /**
   * Returns recently sold listings for the product. Prefer upc when the
   * product has one; otherwise pass a normalized title query.
   */
  fetchSoldListings(upc?: string, query?: string): Promise<SoldListing[]>;
}

export class EbayNotConfigured extends Error {
  constructor() {
    super(
      "eBay sold data is not available: the Marketplace Insights scope is not granted on this app's free tier. Enter market prices manually at /admin/price-intel (market tab).",
    );
    this.name = "EbayNotConfigured";
  }
}

/**
 * Returns the configured EbaySoldClient. Today this always returns a stub
 * that throws EbayNotConfigured — see the research note above. The
 * EBAY_APP_ID env var is intentionally NOT sufficient to enable a real
 * client: an App ID alone cannot reach the sold-data endpoint.
 */
export function getEbaySoldClient(): EbaySoldClient {
  return {
    fetchSoldListings: async () => {
      throw new EbayNotConfigured();
    },
  };
}
