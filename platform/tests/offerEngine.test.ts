import { describe, it, expect } from "vitest";
import {
  computeScore,
  floorToIncrement,
  isWholeIncrement,
  median,
  suggestSplit,
  validatePlan,
  wholeMonthsBetween,
} from "@/lib/offers/engine";

const base = { paidSpendMinor: 0, medianPayDays: null, offersAccepted: 0, offersDeclined: 0, offersExpired: 0, tenureMonths: 0 };

describe("computeScore", () => {
  it("gives a brand-new account neutral points only (10 + 15)", () => {
    const s = computeScore(base);
    expect(s).toMatchObject({ spend: 0, paymentSpeed: 10, acceptance: 15, tenure: 0, total: 25 });
  });

  it("maxes out at 100", () => {
    const s = computeScore({ paidSpendMinor: 10_000_000, medianPayDays: 1, offersAccepted: 5, offersDeclined: 0, offersExpired: 0, tenureMonths: 30 });
    expect(s.total).toBe(100);
  });

  it("every decline and every no-response lowers acceptance", () => {
    const a = computeScore({ ...base, offersAccepted: 4 });
    const b = computeScore({ ...base, offersAccepted: 4, offersDeclined: 1 });
    const c = computeScore({ ...base, offersAccepted: 4, offersDeclined: 1, offersExpired: 1 });
    expect(a.acceptance).toBe(30);
    expect(b.acceptance).toBe(24);
    expect(c.acceptance).toBe(20);
    expect(c.notes.join(" ")).toMatch(/1 declined, 1 no response/);
  });

  it("slow payers lose payment points; 14+ days is zero", () => {
    expect(computeScore({ ...base, medianPayDays: 2 }).paymentSpeed).toBe(20);
    expect(computeScore({ ...base, medianPayDays: 8 }).paymentSpeed).toBe(10);
    expect(computeScore({ ...base, medianPayDays: 30 }).paymentSpeed).toBe(0);
  });

  it("spend uses a square-root curve up to $25,000", () => {
    expect(computeScore({ ...base, paidSpendMinor: 625_000 }).spend).toBe(20); // quarter of the cap → half the points
    expect(computeScore({ ...base, paidSpendMinor: 2_500_000 }).spend).toBe(40);
  });
});

describe("helpers", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("whole months", () => {
    expect(wholeMonthsBetween(new Date("2026-01-15"), new Date("2026-03-14"))).toBe(1);
    expect(wholeMonthsBetween(new Date("2026-01-15"), new Date("2026-03-15"))).toBe(2);
  });
  it("increments", () => {
    expect(floorToIncrement(13, 6)).toBe(12);
    expect(floorToIncrement(5, 6)).toBe(0);
    expect(floorToIncrement(-3, 1)).toBe(0);
    expect(isWholeIncrement(12, 6)).toBe(true);
    expect(isWholeIncrement(0, 6)).toBe(false);
    expect(isWholeIncrement(7, 6)).toBe(false);
  });
});

describe("suggestSplit", () => {
  const c = (accountId: string, score: number, need: number, tiebreak = "2026-01-01") => ({ accountId, score, need, tiebreak });

  it("fills the internal account first, then takes turns by score", () => {
    const r = suggestSplit({ available: 10, increment: 1, internalNeed: 3, candidates: [c("low", 20, 10), c("high", 80, 10)] });
    expect(r.internalQty).toBe(3);
    expect(r.allocations).toEqual([
      { accountId: "high", qty: 4 },
      { accountId: "low", qty: 3 },
    ]);
    expect(r.leftover).toBe(0);
  });

  it("never gives anyone more than they asked for, and reports leftovers", () => {
    const r = suggestSplit({ available: 20, increment: 1, internalNeed: 0, candidates: [c("a", 90, 2), c("b", 50, 3)] });
    expect(r.allocations).toEqual([
      { accountId: "a", qty: 2 },
      { accountId: "b", qty: 3 },
    ]);
    expect(r.leftover).toBe(15);
  });

  it("works in whole increments (cases) and flags buyers who want less than one", () => {
    const r = suggestSplit({ available: 20, increment: 6, internalNeed: 0, candidates: [c("a", 90, 12), c("b", 50, 8), c("tiny", 99, 4)] });
    expect(r.allocations).toEqual([
      { accountId: "a", qty: 12 },
      { accountId: "b", qty: 6 },
    ]);
    expect(r.belowIncrement).toEqual(["tiny"]);
    expect(r.leftover).toBe(2); // 20 - 18: less than a case
  });

  it("caps internal at available, rounded to increments", () => {
    const r = suggestSplit({ available: 10, increment: 4, internalNeed: 100, candidates: [c("a", 90, 8)] });
    expect(r.internalQty).toBe(8);
    expect(r.allocations).toEqual([]);
    expect(r.leftover).toBe(2);
  });

  it("breaks score ties deterministically by tiebreak (older first)", () => {
    const r = suggestSplit({
      available: 1,
      increment: 1,
      internalNeed: 0,
      candidates: [c("newer", 50, 1, "2026-06-01"), c("older", 50, 1, "2025-01-01")],
    });
    expect(r.allocations).toEqual([{ accountId: "older", qty: 1 }]);
  });

  it("handles zero stock and no candidates", () => {
    expect(suggestSplit({ available: 0, increment: 1, internalNeed: 5, candidates: [c("a", 1, 1)] })).toEqual({
      internalQty: 0,
      allocations: [],
      leftover: 0,
      belowIncrement: [],
    });
    expect(suggestSplit({ available: 7, increment: 1, internalNeed: 0, candidates: [] }).leftover).toBe(7);
  });

  it("total handed out never exceeds stock (randomized)", () => {
    for (let t = 0; t < 200; t++) {
      const inc = 1 + Math.floor(Math.random() * 6);
      const available = Math.floor(Math.random() * 60);
      const cands = Array.from({ length: Math.floor(Math.random() * 6) }, (_, i) => c(`acct-${i}`, Math.floor(Math.random() * 100), Math.floor(Math.random() * 30)));
      const r = suggestSplit({ available, increment: inc, internalNeed: Math.floor(Math.random() * 20), candidates: cands });
      const total = r.internalQty + r.allocations.reduce((s, a) => s + a.qty, 0);
      expect(total + r.leftover).toBe(available);
      expect(total).toBeLessThanOrEqual(available);
      for (const a of r.allocations) {
        expect(a.qty % inc).toBe(0);
        expect(a.qty).toBeLessThanOrEqual(cands.find((x) => x.accountId === a.accountId)!.need);
      }
    }
  });
});

describe("validatePlan", () => {
  it("accepts a plan within stock in whole increments", () => {
    expect(validatePlan([{ accountId: "a", qty: 6 }, { accountId: "b", qty: 0 }], 6, 6)).toBeNull();
  });
  it("rejects partial cases, overselling, and duplicates", () => {
    expect(validatePlan([{ accountId: "a", qty: 5 }], 12, 6)).toMatch(/multiples of 6/);
    expect(validatePlan([{ accountId: "a", qty: 6 }, { accountId: "b", qty: 12 }], 12, 6)).toMatch(/only 12/);
    expect(validatePlan([{ accountId: "a", qty: 1 }, { accountId: "a", qty: 1 }], 12, 1)).toMatch(/twice/);
    expect(validatePlan([{ accountId: "a", qty: 1.5 }], 12, 1)).toMatch(/whole numbers/);
  });
});
