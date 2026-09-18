import { describe, it, expect } from "vitest";
import {
  allocateRound,
  describeAllocationPolicy,
  ALLOCATION_POLICY_SNAPSHOT,
  ALLOCATION_POLICY_OPTIONS,
  type AllocationInputLine,
} from "@/lib/allocation/engine";

function line(lineId: string, productId: string, accountId: string, requestedQty: number): AllocationInputLine {
  return { lineId, productId, accountId, requestedQty };
}

/** Per-product summary, throwing if the product is missing (never expected). */
function summaryFor(result: ReturnType<typeof allocateRound>, productId: string) {
  const s = result.summaryByProduct[productId];
  if (!s) throw new Error(`engine result missing summary for ${productId}`);
  return s;
}

/** Allocated qty for a line, throwing if the engine dropped it (never expected). */
function q(result: ReturnType<typeof allocateRound>, lineId: string): number {
  const found = result.lines.find((l) => l.lineId === lineId);
  if (!found) throw new Error(`engine result missing line ${lineId}`);
  return found.allocatedQty;
}

describe("allocateRound — fanzia_first fairness", () => {
  const INTERNAL = "acct-internal";
  const A = "acct-a";
  const B = "acct-b";

  it("fills the internal account first, capped at available, before any external", () => {
    const result = allocateRound({
      lines: [
        line("l-int", "p1", INTERNAL, 50),
        line("l-a", "p1", A, 60),
        line("l-b", "p1", B, 40),
      ],
      availableByProduct: { p1: 100 },
      caseSizes: { p1: 1 },
      internalAccountId: INTERNAL,
    });
    expect(q(result, "l-int")).toBe(50); // filled first, full request
    // remainder 50 split 60:40 → 30/20
    expect(q(result, "l-a")).toBe(30);
    expect(q(result, "l-b")).toBe(20);
    expect(summaryFor(result, "p1").allocated).toBe(100);
    expect(summaryFor(result, "p1").shortfallByAccount[A]).toBe(30);
    expect(summaryFor(result, "p1").shortfallByAccount[B]).toBe(20);
  });

  it("caps internal fill at available — externals get zero when stock is exhausted", () => {
    const result = allocateRound({
      lines: [line("l-int", "p1", INTERNAL, 80), line("l-a", "p1", A, 60)],
      availableByProduct: { p1: 50 },
      caseSizes: { p1: 1 },
      internalAccountId: INTERNAL,
    });
    expect(q(result, "l-int")).toBe(50);
    expect(q(result, "l-a")).toBe(0);
    expect(summaryFor(result, "p1").shortfallByAccount[INTERNAL]).toBe(30);
    expect(summaryFor(result, "p1").shortfallByAccount[A]).toBe(60);
  });

  it("splits the remainder across externals pro-rata (floors), no internal participant", () => {
    const result = allocateRound({
      lines: [line("l-a", "p1", A, 60), line("l-b", "p1", B, 40)],
      availableByProduct: { p1: 50 },
      caseSizes: { p1: 1 },
      internalAccountId: null,
    });
    expect(q(result, "l-a")).toBe(30);
    expect(q(result, "l-b")).toBe(20);
  });

  it("distributes leftover units largest-remainder with deterministic lineId tiebreak", () => {
    // 3 buyers × 50 requested, 40 available → each floor 13, leftover 1 →
    // largest-remainder tie (all fracs equal) goes to smallest lineId.
    const result = allocateRound({
      lines: [
        line("b-line", "p1", A, 50),
        line("a-line", "p1", B, 50),
        line("c-line", "p1", INTERNAL, 50),
      ],
      availableByProduct: { p1: 40 },
      caseSizes: { p1: 1 },
      internalAccountId: null, // all external here to isolate the tiebreak
    });
    expect(q(result, "a-line")).toBe(14);
    expect(q(result, "b-line")).toBe(13);
    expect(q(result, "c-line")).toBe(13);
    expect(q(result, "a-line") + q(result, "b-line") + q(result, "c-line")).toBe(40);
  });

  it("distributes leftover across unequal fractions to the largest fractional remainder", () => {
    // requested 27/13 over 40 available → exact 27.0/13.0: no leftover.
    // requested 30/30/40 over 51 → exact 15.3/15.3/20.4 → floors 15/15/20,
    // leftover 1 → the .4 line (c) wins over the two .3 lines.
    const result = allocateRound({
      lines: [
        line("l-a", "p1", A, 30),
        line("l-b", "p1", B, 30),
        line("l-c", "p1", INTERNAL, 40),
      ],
      availableByProduct: { p1: 51 },
      caseSizes: { p1: 1 },
      internalAccountId: null,
    });
    expect(q(result, "l-c")).toBe(21);
    expect(q(result, "l-a")).toBe(15);
    expect(q(result, "l-b")).toBe(15);
  });

  it("snaps each allocation DOWN to case-size multiples, returning freed units as whole cases to the largest fractional remainder", () => {
    // avail 40, requests 27/13 → exact split 27/13 (pro-rata of 27:13).
    // Snap to cases of 10: 20/10, freeing 10 → largest frac (27 → .7) wins a case back.
    const result = allocateRound({
      lines: [line("l-a", "p1", A, 27), line("l-b", "p1", B, 13)],
      availableByProduct: { p1: 40 },
      caseSizes: { p1: 10 },
      internalAccountId: null,
    });
    expect(q(result, "l-a")).toBe(30);
    expect(q(result, "l-b")).toBe(10);
    expect(q(result, "l-a") + q(result, "l-b")).toBeLessThanOrEqual(40);
    expect(q(result, "l-a") % 10).toBe(0);
    expect(q(result, "l-b") % 10).toBe(0);
  });

  it("snapping never lets the total exceed available", () => {
    // avail 35, requests 20/20, case 10 → exact 17.5/17.5 → snap 10/10,
    // freed 15 → largest frac tie (.5/.5) → first lineId gets +10 → 20/10.
    const result = allocateRound({
      lines: [line("l-a", "p1", A, 20), line("l-b", "p1", B, 20)],
      availableByProduct: { p1: 35 },
      caseSizes: { p1: 10 },
      internalAccountId: null,
    });
    expect(q(result, "l-a")).toBe(20);
    expect(q(result, "l-b")).toBe(10);
    expect(q(result, "l-a") + q(result, "l-b")).toBe(30);
  });

  it("zero availability allocates zero everywhere with full shortfalls", () => {
    const result = allocateRound({
      lines: [line("l-int", "p1", INTERNAL, 10), line("l-a", "p1", A, 20)],
      availableByProduct: { p1: 0 },
      caseSizes: { p1: 1 },
      internalAccountId: INTERNAL,
    });
    expect(q(result, "l-int")).toBe(0);
    expect(q(result, "l-a")).toBe(0);
    expect(summaryFor(result, "p1").shortfallByAccount[INTERNAL]).toBe(10);
    expect(summaryFor(result, "p1").shortfallByAccount[A]).toBe(20);
  });

  it("a single external buyer gets min(requested, available)", () => {
    const over = allocateRound({
      lines: [line("l-a", "p1", A, 100)],
      availableByProduct: { p1: 40 },
      caseSizes: { p1: 1 },
      internalAccountId: null,
    });
    expect(q(over, "l-a")).toBe(40);

    const under = allocateRound({
      lines: [line("l-a", "p1", A, 20)],
      availableByProduct: { p1: 40 },
      caseSizes: { p1: 1 },
      internalAccountId: null,
    });
    expect(q(under, "l-a")).toBe(20);
    expect(summaryFor(under, "p1").shortfallByAccount).toEqual({});
  });

  it("processes each product independently with its own availability and case size", () => {
    const result = allocateRound({
      lines: [
        line("l-int-1", "p1", INTERNAL, 50),
        line("l-a-1", "p1", A, 50),
        line("l-a-2", "p2", A, 12),
      ],
      availableByProduct: { p1: 60, p2: 10 },
      caseSizes: { p1: 1, p2: 6 },
      internalAccountId: INTERNAL,
    });
    expect(q(result, "l-int-1")).toBe(50); // internal first on p1
    expect(q(result, "l-a-1")).toBe(10); // remainder
    expect(q(result, "l-a-2")).toBe(6); // snapped down from 10 to case of 6 (freed 4 < 6)
    expect(summaryFor(result, "p2").shortfallByAccount[A]).toBe(6);
  });

  it("clamps negative or fractional requests to non-negative integers", () => {
    const result = allocateRound({
      lines: [line("l-a", "p1", A, -5), line("l-b", "p1", B, 7.9)],
      availableByProduct: { p1: 10 },
      caseSizes: { p1: 1 },
      internalAccountId: null,
    });
    expect(q(result, "l-a")).toBe(0);
    expect(q(result, "l-b")).toBe(7);
    expect(result.lines.find((l) => l.lineId === "l-b")!.requestedQty).toBe(7);
  });

  it("internal account with multiple lines splits its fill pro-rata across them", () => {
    const result = allocateRound({
      lines: [line("l-int-1", "p1", INTERNAL, 30), line("l-int-2", "p1", INTERNAL, 10)],
      availableByProduct: { p1: 25 },
      caseSizes: { p1: 1 },
      internalAccountId: INTERNAL,
    });
    // 30:10 over 25 → 18.75/6.25 → floors 18/6, leftover 1 → .75 line wins
    expect(q(result, "l-int-1")).toBe(19);
    expect(q(result, "l-int-2")).toBe(6);
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const input = {
      lines: [
        line("l1", "p1", INTERNAL, 33),
        line("l2", "p1", A, 47),
        line("l3", "p1", B, 19),
        line("l4", "p2", A, 8),
      ],
      availableByProduct: { p1: 77, p2: 5 },
      caseSizes: { p1: 6, p2: 1 },
      internalAccountId: INTERNAL,
    };
    expect(allocateRound(input)).toEqual(allocateRound(input));
  });

  it("exposes the fanzia_first policy snapshot constant and plain-words description", () => {
    expect(ALLOCATION_POLICY_SNAPSHOT).toEqual({
      mode: "fanzia_first",
      external_split: "pro_rata_largest_remainder",
    });
    expect(ALLOCATION_POLICY_OPTIONS.map((o) => o.mode)).toContain("fanzia_first");
    expect(describeAllocationPolicy()).toContain("Fanzia internal filled first");
    expect(describeAllocationPolicy()).toContain("pro-rata");
  });
});
