/** Pure business rules for order requests, invoices, and payments.
 * All amounts are integer minor units (cents). These functions have no I/O
 * so they are trivially unit-testable. */

export const ORDER_MINIMUM_MINOR = 50000; // $500 order minimum (subtotal, before fees)
export const SMALL_ORDER_THRESHOLD_MINOR = 75000; // $750 — fee applies below this
export const SMALL_ORDER_FEE_MINOR = 2500; // $25 small-order fee
export const FIRST_ORDER_CAP_MINOR = 500000; // $5,000 first-order cap
export const OFFER_EXPIRY_HOURS = 48;
/**
 * Rollover policy: at most ONE silent-free automatic rollover per offer.
 * The first expiry extends the offer automatically (audit-logged, actor
 * system); any later expiry requires explicit buyer reacceptance.
 */
export const MAX_SILENT_ROLLOVERS = 1;

export type PaymentMethod = "card" | "ach" | "wire";

export const PAYMENT_METHODS: PaymentMethod[] = ["card", "ach", "wire"];

/**
 * Buyer kind for fee purposes: 'internal' is Fanzia's own vending buyer
 * account (Fanzia-as-client design 2026-09-18 §1.1); 'external' is every
 * other buyer. Mirrors db/schema/account.ts `accountKind`.
 */
export type AccountKind = "internal" | "external";

export function isValidPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}

/**
 * $25 fee when the subtotal is under $750 AND the buyer is external; $0
 * otherwise. The internal buyer (Fanzia's own vending account) never
 * pays the fee — it's our own money moving between our own pockets; the
 * fee exists to make small external orders economic, not to tax ourselves
 * (Fanzia-as-client design 2026-09-18 §1.1).
 */
export function computeSmallOrderFee(subtotalMinor: number, accountKind: AccountKind): number {
  if (accountKind === "internal") return 0;
  return subtotalMinor < SMALL_ORDER_THRESHOLD_MINOR ? SMALL_ORDER_FEE_MINOR : 0;
}

/** The $500 minimum applies to the subtotal before fees. */
export function meetsMinimum(subtotalMinor: number): boolean {
  return subtotalMinor >= ORDER_MINIMUM_MINOR;
}

/**
 * The $5,000 first-order cap applies when the account has no prior
 * non-void invoices. (priorInvoiceCount counts invoices with
 * status != 'void' for the account.)
 */
export function firstOrderCapApplies(priorInvoiceCount: number): boolean {
  return priorInvoiceCount === 0;
}

/** Offers expire 48 hours after the buyer submits the request. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * Hard cap for the state machine: an offer may be silently auto-rolled
 * over only while it has consumed fewer than MAX_SILENT_ROLLOVERS.
 * Never implied, never rounded up — once the budget is spent the offer
 * expires for good and only explicit buyer reacceptance revives it.
 */
export function canAutoRollover(rolloverCount: number): boolean {
  return rolloverCount < MAX_SILENT_ROLLOVERS;
}

/** The new expiry after a rollover: another full 48-hour window from now. */
export function rolloverExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);
}

/** Taxable unless the account's tax status was explicitly determined exempt. "pending" counts as taxable. */
export function isTaxable(taxStatus: string): boolean {
  return taxStatus !== "exempt";
}

/** Add N business days, skipping Saturday/Sunday. No holiday calendar. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/**
 * funds_cleared_at at record time:
 * - card: clears immediately (same as paid_at)
 * - ach: +5 business days for the account's first three recorded payments, +2 after
 * - wire: NULL until an owner explicitly confirms receipt
 */
export function computeFundsClearedAt(
  method: PaymentMethod,
  paidAt: Date,
  priorPaymentCount: number,
): Date | null {
  if (method === "card") return new Date(paidAt.getTime());
  if (method === "wire") return null;
  return addBusinessDays(paidAt, priorPaymentCount < 3 ? 5 : 2);
}

export type ClearedPaymentLike = {
  amountMinor: number;
  fundsClearedAt: Date | null;
};

/**
 * An invoice is "cleared" only when cleared funds (funds_cleared_at <= now)
 * cover the total. Uncleared or future-cleared payments don't count.
 */
export function invoiceCleared(
  totalMinor: number,
  payments: ClearedPaymentLike[],
  now: Date = new Date(),
): boolean {
  const cleared = payments
    .filter((p) => p.fundsClearedAt !== null && p.fundsClearedAt.getTime() <= now.getTime())
    .reduce((sum, p) => sum + p.amountMinor, 0);
  return cleared >= totalMinor;
}

/** Sum of all recorded payment amounts (cleared or not) — what the buyer has paid toward the invoice. */
export function totalPaid(payments: { amountMinor: number }[]): number {
  return payments.reduce((sum, p) => sum + p.amountMinor, 0);
}

/** Remaining balance counting every recorded payment, cleared or not. */
export function balanceDue(totalMinor: number, payments: { amountMinor: number }[]): number {
  return totalMinor - totalPaid(payments);
}
