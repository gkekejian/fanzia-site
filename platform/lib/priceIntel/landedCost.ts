/**
 * Landed-cost engine (W5). Pure functions — no DB, no I/O — so they can be
 * unit-tested and imported by the PO-pack worker via dynamic import.
 *
 * STABLE CONTRACT: this file's path (lib/priceIntel/landedCost.ts) and the
 * export names `landedUnitCost` / `cheapestSupplierFor` are consumed by the
 * PO-pack worker — do not rename either.
 *
 * All money is minor units. `fxRates` maps an ISO currency code to the
 * USD-minor value of ONE MINOR UNIT of that currency, e.g. JPY→USD 0.66
 * means ¥1 (JPY minor) is worth $0.0066 (0.66 USD cents). USD is implied 1
 * and never needs an entry. The human-entered rate (USD per foreign major
 * unit, e.g. 0.0066) is converted to this minor-based form by
 * loadFxRates() using the currency table's exponents — the engine stays
 * exponent-free and pure.
 */

export type FxRates = Record<string, number>;

export type ShippingRule =
  | { type: "flat_per_order"; amountMinor: number }
  | { type: "per_case"; amountMinor: number }
  | { type: "free_over"; thresholdMinor: number };

export class FxRateMissingError extends Error {
  constructor(currency: string) {
    super(
      `No FX rate to USD for ${currency}: an owner must set one at /admin/price-intel before this supplier can be compared.`,
    );
    this.name = "FxRateMissingError";
  }
}

export type LandedUnitCostInput = {
  unitPriceMinor: number;
  currency: string;
  fxRates: FxRates;
  shippingRule: ShippingRule | null;
  paymentFeeBps: number;
  /** Units in the order — required to allocate flat_per_order / per_case. */
  qtyUnits?: number;
  /** Units per case — required for per_case rules. */
  caseSize?: number | null;
  /**
   * Order subtotal in USD minor — compared against thresholdMinor for
   * free_over rules. Defaults to unit price × qtyUnits (single-supplier,
   * single-product order assumption).
   */
  subtotalMinorUsd?: number;
};

/**
 * Per-unit landed cost in USD minor: FX-converted unit price + allocated
 * shipping share + payment-processor fee, all rounded per unit.
 *
 * Shipping allocation:
 * - flat_per_order: flat fee spread evenly over qtyUnits in the order.
 * - per_case: ceil(qtyUnits / caseSize) cases × amount, spread over qtyUnits.
 * - free_over: 0 when subtotal >= threshold. Below the threshold the
 *   supplier's under-threshold shipping quote isn't known at comparison
 *   time (it depends on the actual order), so shipping is modeled as 0 —
 *   the comparison table flags free_over rows as "excludes shipping below
 *   the free threshold" rather than pretending precision.
 */
export function landedUnitCost(input: LandedUnitCostInput): number {
  const {
    unitPriceMinor,
    currency,
    fxRates,
    shippingRule,
    paymentFeeBps,
    qtyUnits = 1,
    caseSize = null,
    subtotalMinorUsd,
  } = input;

  if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error(`unitPriceMinor must be a non-negative number, got ${unitPriceMinor}`);
  }
  if (!Number.isInteger(qtyUnits) || qtyUnits < 1) {
    throw new Error(`qtyUnits must be a positive integer, got ${qtyUnits}`);
  }

  const rate = currency === "USD" ? 1 : fxRates[currency];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw new FxRateMissingError(currency);
  }
  const unitUsdMinor = Math.round(unitPriceMinor * rate);

  let shippingPerUnitMinor = 0;
  if (shippingRule) {
    switch (shippingRule.type) {
      case "flat_per_order":
        shippingPerUnitMinor = Math.round(shippingRule.amountMinor / qtyUnits);
        break;
      case "per_case": {
        if (!caseSize || caseSize < 1) {
          throw new Error(
            `per_case shipping rule requires caseSize >= 1 (qtyUnits=${qtyUnits})`,
          );
        }
        const cases = Math.ceil(qtyUnits / caseSize);
        shippingPerUnitMinor = Math.round((cases * shippingRule.amountMinor) / qtyUnits);
        break;
      }
      case "free_over": {
        const subtotal = subtotalMinorUsd ?? unitUsdMinor * qtyUnits;
        shippingPerUnitMinor = subtotal >= shippingRule.thresholdMinor ? 0 : 0;
        break;
      }
    }
  }

  const preFeeMinor = unitUsdMinor + shippingPerUnitMinor;
  const feeMinor = Math.round((preFeeMinor * paymentFeeBps) / 10_000);
  return preFeeMinor + feeMinor;
}

export type SupplierCandidatePrice = {
  supplierId: string;
  unitPriceMinor: number;
  currency: string;
  shippingRule: ShippingRule | null;
  caseSize?: number | null;
  paymentFeeBps: number;
  subtotalMinorUsd?: number;
};

/**
 * Adapter for the PO-pack worker's dynamic import (lib/po/pack.ts
 * `suggestSupplierFor`). It probes this module for `suggestSupplierFor`
 * or `suggestSupplier` with a (productId, qty) call shape and expects a
 * supplierId string back (or nothing, in which case it falls back to the
 * round's supplier).
 *
 * With only (productId, qty) the pure engine has no candidate prices to
 * compare, so it returns null and the caller falls back — the designed
 * behavior. Callers that DO have candidate prices loaded should call
 * cheapestSupplierFor directly instead.
 */
export function suggestSupplierFor(
  productId: string,
  qtyUnits: number,
  candidatePrices: SupplierCandidatePrice[] = [],
  fxRates: FxRates = {},
): string | null {
  const best = cheapestSupplierFor(productId, qtyUnits, candidatePrices, fxRates);
  return best ? best.supplierId : null;
}

/** Alias probed second by the PO-pack worker; same adapter. */
export const suggestSupplier = suggestSupplierFor;

/**
 * Picks the supplier with the lowest per-unit landed cost for the given
 * quantity. Candidates that can't be priced (missing FX rate, invalid
 * rule config) are skipped, not fatal — a bad row in one supplier's data
 * must not hide the others. Returns null when no candidate can be priced.
 */
export function cheapestSupplierFor(
  productId: string,
  qtyUnits: number,
  candidatePrices: SupplierCandidatePrice[],
  fxRates: FxRates = {},
): { supplierId: string; landedCostMinor: number } | null {
  void productId; // part of the stable call signature; used by callers for logging/audit
  let best: { supplierId: string; landedCostMinor: number } | null = null;
  for (const c of candidatePrices) {
    let landed: number;
    try {
      landed = landedUnitCost({
        unitPriceMinor: c.unitPriceMinor,
        currency: c.currency,
        fxRates,
        shippingRule: c.shippingRule,
        paymentFeeBps: c.paymentFeeBps,
        qtyUnits,
        caseSize: c.caseSize,
        subtotalMinorUsd: c.subtotalMinorUsd,
      });
    } catch {
      continue;
    }
    if (!best || landed < best.landedCostMinor) {
      best = { supplierId: c.supplierId, landedCostMinor: landed };
    }
  }
  return best;
}
