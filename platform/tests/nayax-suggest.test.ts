import { describe, it, expect } from "vitest";
import { suggestRestock, type SuggestInput } from "@/lib/nayax/suggest";

/**
 * Encodes fanzia-as-client-design-2026-09-18.md §3.4's worked example
 * EXACTLY: a Japanese booster pack sold loose in two machines.
 *
 *  - Machine A (Glendale): 84 packs in 28 days → velocity 3.0/day.
 *    Slot capacity 40, restocked 10 days ago → on-hand = 40 − 30 = 10.
 *  - Machine B (Lakewood): 56 packs in 28 days → velocity 2.0/day.
 *    On-hand = 40 − 20 = 20.
 *  - Params: lead 14d (Japan), safety 7d, review 7d → 28 days of target cover.
 *
 *  A: reorder point = (14+7) × 3.0 = 63; on-hand 10 < 63 →
 *     suggest ceil(28 × 3.0 − 10) = 74.
 *  B: reorder point = (14+7) × 2.0 = 42; on-hand 20 < 42 →
 *     suggest ceil(28 × 2.0 − 20) = 36.
 *  Aggregate 110 → snap up to 36-pack booster boxes → 4 boxes (144 packs).
 *  Days of cover: A = 10 ÷ 3.0 = 3.3d → "urgent" (below the 7d safety
 *  line); B = 20 ÷ 2.0 = 10d → "watch".
 */
function workedExampleInput(): SuggestInput[] {
  return [
    {
      productId: "prod-jp-booster",
      sku: "KP-ABYSS-EYE-PACK",
      name: "Abyss Eye booster pack (JP)",
      isNew: false,
      params: {
        leadTimeDays: 14,
        safetyStockDays: 7,
        reviewPeriodDays: 7,
        minOrderUnits: 1,
        caseUnits: 36,
      },
      machines: [
        {
          machineId: "machine-a",
          machineName: "Glendale",
          dailySales: Array(28).fill(3), // 84 packs / 28 days
          onHand: 10,
        },
        {
          machineId: "machine-b",
          machineName: "Lakewood",
          dailySales: Array(28).fill(2), // 56 packs / 28 days
          onHand: 20,
        },
      ],
    },
  ];
}

describe("nayax suggestion engine — design doc §3.4 worked example", () => {
  it("computes per-machine velocity, reorder points, and suggestions", () => {
    const line = suggestRestock(workedExampleInput())[0]!;
    expect(line).toBeDefined();
    expect(line.sku).toBe("KP-ABYSS-EYE-PACK");
    expect(line.isNew).toBe(false);

    const a = line.machines[0]!;
    const b = line.machines[1]!;
    expect(a.velocity).toBe(3);
    expect(a.reorderPoint).toBe(63);
    expect(a.suggestedUnits).toBe(74);

    expect(b.velocity).toBe(2);
    expect(b.reorderPoint).toBe(42);
    expect(b.suggestedUnits).toBe(36);
  });

  it("flags days of cover: A urgent (3.3d), B watch (10d)", () => {
    const line = suggestRestock(workedExampleInput())[0]!;
    expect(line).toBeDefined();
    const a = line.machines[0]!;
    const b = line.machines[1]!;
    expect(a.daysOfCover).toBeCloseTo(3.33, 2);
    expect(a.flags).toContain("urgent");
    expect(b.daysOfCover).toBe(10);
    expect(b.flags).toContain("watch");
  });

  it("aggregates 110 packs and snaps UP to 4 boxes of 36", () => {
    const line = suggestRestock(workedExampleInput())[0]!;
    expect(line).toBeDefined();
    expect(line.aggregateUnits).toBe(110);
    expect(line.cases).toBe(4);
    expect(line.caseUnits).toBe(36);
  });

  it("suggests nothing when on-hand sits above the reorder point", () => {
    const input = workedExampleInput()[0]!;
    input.machines[0]!.onHand = 70; // above 63 reorder point
    input.machines[1]!.onHand = 50; // above 42 reorder point
    const line = suggestRestock([input])[0]!;
    expect(line.machines[0]!.suggestedUnits).toBe(0);
    expect(line.machines[1]!.suggestedUnits).toBe(0);
    expect(line.aggregateUnits).toBe(0);
    expect(line.cases).toBe(0);
  });
});

describe("nayax suggestion engine — edge flags", () => {
  it("flags 'low-data' when a machine has fewer than 14 days of history", () => {
    const line = suggestRestock([
      {
        productId: "p1",
        sku: "SKU-1",
        name: "New-ish pack",
        params: { leadTimeDays: 5, safetyStockDays: 7, reviewPeriodDays: 7, minOrderUnits: 1, caseUnits: 36 },
        machines: [
          {
            machineId: "m1",
            machineName: "Glendale",
            dailySales: Array(10).fill(2), // only 10 days of history
            onHand: 5,
          },
        ],
      },
    ])[0]!;
    expect(line.machines[0]!.lowData).toBe(true);
    expect(line.machines[0]!.flags).toContain("low-data");
    expect(line.flags).toContain("low-data");
    // Velocity still uses the 28-day window: 20 units / 28 = 0.71/day.
    expect(line.machines[0]!.velocity).toBeCloseTo(0.71, 2);
  });

  it("new products suggest the owner-set trial qty, flagged NEW", () => {
    const line = suggestRestock([
      {
        productId: "p2",
        sku: "SKU-NEW",
        name: "Unreleased set pack",
        isNew: true,
        params: { leadTimeDays: 14, safetyStockDays: 7, reviewPeriodDays: 7, minOrderUnits: 1, caseUnits: 36, trialQty: 36 },
        machines: [{ machineId: "m1", machineName: "Glendale", dailySales: [], onHand: null }],
      },
    ])[0]!;
    expect(line.isNew).toBe(true);
    expect(line.aggregateUnits).toBe(36);
    expect(line.cases).toBe(1);
    expect(line.flags).toContain("NEW");
  });

  it("treats unknown on-hand as 0 for math but flags baseline-unknown", () => {
    const line = suggestRestock([
      {
        productId: "p3",
        sku: "SKU-3",
        name: "Never-restocked pack",
        params: { leadTimeDays: 5, safetyStockDays: 7, reviewPeriodDays: 7, minOrderUnits: 1, caseUnits: 12 },
        machines: [
          { machineId: "m1", machineName: "Glendale", dailySales: Array(28).fill(1), onHand: null },
        ],
      },
    ])[0]!;
    const m = line.machines[0]!;
    expect(m.onHand).toBeNull();
    expect(m.flags).toContain("baseline-unknown");
    // (5+7+7) × 1 − 0 = 19 units suggested; cover is unknowable.
    expect(m.suggestedUnits).toBe(19);
    expect(m.daysOfCover).toBeNull();
  });

  it("rounds fractional velocity UP (ceil) and never suggests below MOQ", () => {
    const line = suggestRestock([
      {
        productId: "p4",
        sku: "SKU-4",
        name: "Slow mover",
        params: { leadTimeDays: 5, safetyStockDays: 7, reviewPeriodDays: 7, minOrderUnits: 24, caseUnits: 36 },
        machines: [
          { machineId: "m1", machineName: "Glendale", dailySales: Array(28).fill(1), onHand: 0 },
        ],
      },
    ])[0]!;
    // Raw suggestion = ceil(19 × 1 − 0) = 19, MOQ lifts it to 24, cases snap to 1 box.
    expect(line.machines[0]!.suggestedUnits).toBe(19);
    expect(line.aggregateUnits).toBe(24);
    expect(line.cases).toBe(1);
  });
});
