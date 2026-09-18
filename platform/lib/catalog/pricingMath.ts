/**
 * Build prompt §9: `price = cost × (1 + markup_bps)` is a markup, and the
 * resulting `(price - cost) / price` is a *different, smaller* number — the
 * gross margin. The two must never be labeled interchangeably anywhere in
 * the UI or API (test gate #6). This module is the single place both
 * formulas live, so every caller (import publish, admin display, buyer
 * price lookup) computes them the same way.
 */
export const BPS_DENOMINATOR = 10000;

export function priceFromCostAndMarkup(costMinor: number, markupBps: number): number {
  return Math.round(costMinor * (1 + markupBps / BPS_DENOMINATOR));
}

/** Always < markupBps for any positive cost — see module comment. */
export function realizedGrossMarginBps(costMinor: number, priceMinor: number): number {
  if (priceMinor <= 0) return 0;
  return Math.round(((priceMinor - costMinor) / priceMinor) * BPS_DENOMINATOR);
}

export function isBelowMarkupFloor(markupBps: number, floorBps: number): boolean {
  return markupBps < floorBps;
}

/**
 * The BUYER's potential retail margin: (msrp - price) / msrp, in basis
 * points. This is the buyer's unit economics — what they keep if they sell
 * at MSRP — and is a different number from both `markupBps` (Fanzia's
 * markup on cost) and `realizedGrossMarginBps` (Fanzia's gross margin on
 * cost). The three must never be labeled interchangeably.
 *
 * Returns null when MSRP is unknown (null) or non-positive — a margin is
 * never invented from a missing MSRP. A negative margin (MSRP below our
 * wholesale price) is returned honestly, not clamped.
 */
export function buyerMargin(
  priceMinor: number,
  msrpMinor: number | null,
): { marginMinor: number; marginBps: number } | null {
  if (msrpMinor === null || msrpMinor <= 0) return null;
  return {
    marginMinor: msrpMinor - priceMinor,
    marginBps: Math.round(((msrpMinor - priceMinor) / msrpMinor) * BPS_DENOMINATOR),
  };
}
