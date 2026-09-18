/**
 * Pure suggestion algorithm — design doc §3.3, worked example §3.4.
 *
 * Deliberately side-effect free and DB free: the orchestration layer
 * (lib/nayax/weekly.ts) builds the inputs from nayax_sale / nayax_restock /
 * restock_params and persists the output. Deterministic and explainable —
 * no ML (design §3.3: the owner can read every number on the review
 * screen and reproduce it by hand).
 *
 * Per SKU, per machine, then aggregated:
 *  1. velocity = units sold in the trailing window ÷ window days
 *     (flag 'low-data' when fewer than MIN_HISTORY_DAYS of history)
 *  2. on-hand estimate (sales-derived, reset by the "I restocked" action;
 *     null = no restock baseline → flagged 'baseline-unknown', math runs
 *     with on-hand treated as 0 so the review screen shows the shortfall
 *     loudly rather than hiding it)
 *  3. days of cover = on-hand ÷ velocity
 *  4. reorder point = (leadTime + safetyStock) × velocity
 *  5. if on-hand < reorder point:
 *       suggested = ceil((lead + safety + review) × velocity − on-hand)
 *     else 0
 *  6. aggregate across machines, then snap UP to case sizes; never below
 *     the distributor MOQ (minOrderUnits)
 *  7. products with no sales history → owner-set trial qty, flagged 'NEW'
 */

export const VELOCITY_WINDOW_DAYS = 28;
export const MIN_HISTORY_DAYS = 14;

export type MachineInput = {
  machineId: string;
  machineName: string;
  /** Units sold per day, oldest → newest. Length = days of history. */
  dailySales: number[];
  /** Sales-derived on-hand; null = no restock baseline on record. */
  onHand: number | null;
};

export type RestockParamsInput = {
  leadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
  minOrderUnits: number;
  caseUnits: number;
  trialQty?: number | null;
};

export type SuggestInput = {
  productId: string;
  sku: string;
  name: string;
  machines: MachineInput[];
  params: RestockParamsInput;
  /** No sales history — suggest the owner-set trial quantity instead. */
  isNew?: boolean;
};

export type MachineSuggestion = {
  machineId: string;
  machineName: string;
  velocity: number;
  onHand: number | null;
  daysOfCover: number | null;
  reorderPoint: number;
  suggestedUnits: number;
  lowData: boolean;
  flags: string[];
};

export type SuggestionLine = {
  productId: string;
  sku: string;
  name: string;
  isNew: boolean;
  machines: MachineSuggestion[];
  aggregateUnits: number;
  cases: number;
  caseUnits: number;
  flags: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function velocityOf(dailySales: number[]): number {
  if (dailySales.length === 0) return 0;
  return dailySales.reduce((a, b) => a + b, 0) / VELOCITY_WINDOW_DAYS;
}

export function suggestRestock(inputs: SuggestInput[]): SuggestionLine[] {
  return inputs.map((input) => {
    const { leadTimeDays: lead, safetyStockDays: safety, reviewPeriodDays: review } = input.params;
    const caseUnits = Math.max(1, Math.floor(input.params.caseUnits || 1));

    // New products have no velocity — the owner picks the trial quantity.
    if (input.isNew) {
      const trial = Math.max(1, Math.floor(input.params.trialQty ?? caseUnits));
      const cases = Math.ceil(trial / caseUnits);
      return {
        productId: input.productId,
        sku: input.sku,
        name: input.name,
        isNew: true,
        machines: input.machines.map((m) => ({
          machineId: m.machineId,
          machineName: m.machineName,
          velocity: 0,
          onHand: m.onHand,
          daysOfCover: null,
          reorderPoint: 0,
          suggestedUnits: 0,
          lowData: true,
          flags: ["NEW"],
        })),
        aggregateUnits: trial,
        cases,
        caseUnits,
        flags: ["NEW"],
      };
    }

    const machines: MachineSuggestion[] = input.machines.map((m) => {
      const lowData = m.dailySales.length < MIN_HISTORY_DAYS;
      const velocity = velocityOf(m.dailySales);
      const reorderPoint = round2((lead + safety) * velocity);
      const onHand = m.onHand;
      const flags: string[] = [];
      if (lowData) flags.push("low-data");
      if (onHand == null) flags.push("baseline-unknown");

      let daysOfCover: number | null = null;
      if (velocity > 0 && onHand != null) {
        daysOfCover = round2(onHand / velocity);
        if (daysOfCover < safety) flags.push("urgent");
        else if (daysOfCover < lead + safety) flags.push("watch");
      } else if (velocity === 0) {
        flags.push("no-sales");
      }

      // Design §3.3 rule 5: order only below the reorder point.
      const effectiveOnHand = onHand ?? 0;
      const suggestedUnits =
        effectiveOnHand < reorderPoint
          ? Math.ceil((lead + safety + review) * velocity - effectiveOnHand)
          : 0;

      return {
        machineId: m.machineId,
        machineName: m.machineName,
        velocity: round2(velocity),
        onHand,
        daysOfCover,
        reorderPoint,
        suggestedUnits,
        lowData,
        flags,
      };
    });

    const aggregateUnits = machines.reduce((a, m) => a + m.suggestedUnits, 0);
    const withMoq = Math.max(aggregateUnits, aggregateUnits > 0 ? input.params.minOrderUnits : 0);
    const cases = withMoq > 0 ? Math.ceil(withMoq / caseUnits) : 0;

    const flags: string[] = [];
    if (machines.some((m) => m.lowData)) flags.push("low-data");
    if (machines.some((m) => m.flags.includes("urgent"))) flags.push("urgent");
    if (machines.some((m) => m.flags.includes("watch"))) flags.push("watch");
    if (machines.some((m) => m.flags.includes("baseline-unknown"))) flags.push("baseline-unknown");

    return {
      productId: input.productId,
      sku: input.sku,
      name: input.name,
      isNew: false,
      machines,
      aggregateUnits: withMoq,
      cases,
      caseUnits,
      flags,
    };
  });
}
