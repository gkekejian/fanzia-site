import { describe, it, expect } from "vitest";
import { buyerMargin, BPS_DENOMINATOR } from "@/lib/catalog/pricingMath";

/**
 * Buyer margin vs MSRP: (msrp - price) / msrp. This is the BUYER's unit
 * economics — what they keep selling at MSRP — and is deliberately a
 * different number from Fanzia's markup (price = cost × (1 + markup)) and
 * Fanzia's realized gross margin ((price - cost) / price). The three must
 * never be labeled interchangeably.
 */
describe("buyerMargin", () => {
  it("computes per-unit margin dollars and basis points", () => {
    // $10.00 wholesale, $14.99 MSRP → $4.99 margin = 33.29%
    const m = buyerMargin(1000, 1499);
    expect(m).not.toBeNull();
    expect(m!.marginMinor).toBe(499);
    expect(m!.marginBps).toBe(Math.round((499 / 1499) * BPS_DENOMINATOR));
  });

  it("returns null when MSRP is unknown — margins are never invented", () => {
    expect(buyerMargin(1000, null)).toBeNull();
  });

  it("returns null for non-positive MSRP", () => {
    expect(buyerMargin(1000, 0)).toBeNull();
    expect(buyerMargin(1000, -500)).toBeNull();
  });

  it("returns a negative margin honestly when MSRP is below wholesale price", () => {
    // $12.00 wholesale, $10.00 MSRP → -$2.00 margin, shown not clamped.
    const m = buyerMargin(1200, 1000);
    expect(m).not.toBeNull();
    expect(m!.marginMinor).toBe(-200);
    expect(m!.marginBps).toBeLessThan(0);
  });

  it("is zero when price equals MSRP", () => {
    const m = buyerMargin(1000, 1000);
    expect(m).not.toBeNull();
    expect(m!.marginMinor).toBe(0);
    expect(m!.marginBps).toBe(0);
  });
});
