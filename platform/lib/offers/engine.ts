/**
 * Pure allocation-offer math (docs/allocation-design.md §5-§7). No I/O:
 * everything here is unit-tested in tests/offerEngine.test.ts.
 */
import type { ScoreDetail } from "@/db/schema";
import { formatMoney } from "@/lib/format";

// ── Buyer score ───────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = { spend: 40, paymentSpeed: 20, acceptance: 30, tenure: 10 } as const;
/** Trailing spend that earns full spend points ($25,000). */
export const FULL_SPEND_MINOR = 2_500_000;
/** Median days-to-pay at or under this earns full payment points. */
export const FAST_PAY_DAYS = 2;
/** Median days-to-pay at or over this earns zero payment points. */
export const SLOW_PAY_DAYS = 14;
/** Months of tenure that earn full tenure points. */
export const FULL_TENURE_MONTHS = 12;

export type ScoreInputs = {
  /** Paid invoice totals over the trailing 12 months, minor units. */
  paidSpendMinor: number;
  /** Median days from invoice sent to funds cleared; null = no paid invoices yet. */
  medianPayDays: number | null;
  /** Offers accepted / declined / let expire over the trailing 12 months. */
  offersAccepted: number;
  offersDeclined: number;
  offersExpired: number;
  /** Whole months since the account was created. */
  tenureMonths: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}

/**
 * 0-100 buyer score. Neutral defaults for no history (payment speed 10/20,
 * acceptance 15/30) so a new account is neither punished nor favored.
 * Every decline and every no-response counts against acceptance.
 */
export function computeScore(input: ScoreInputs): ScoreDetail {
  const spend = Math.round(SCORE_WEIGHTS.spend * Math.sqrt(clamp01(input.paidSpendMinor / FULL_SPEND_MINOR)));

  let paymentSpeed: number;
  if (input.medianPayDays === null) paymentSpeed = SCORE_WEIGHTS.paymentSpeed / 2;
  else {
    const frac = clamp01((SLOW_PAY_DAYS - Math.max(input.medianPayDays, FAST_PAY_DAYS)) / (SLOW_PAY_DAYS - FAST_PAY_DAYS));
    paymentSpeed = Math.round(SCORE_WEIGHTS.paymentSpeed * frac);
  }

  const answered = input.offersAccepted + input.offersDeclined + input.offersExpired;
  const acceptance =
    answered === 0 ? SCORE_WEIGHTS.acceptance / 2 : Math.round((SCORE_WEIGHTS.acceptance * input.offersAccepted) / answered);

  const tenure = Math.round(SCORE_WEIGHTS.tenure * clamp01(input.tenureMonths / FULL_TENURE_MONTHS));

  const notes: string[] = [];
  notes.push(`${formatMoney(Math.max(0, input.paidSpendMinor))} paid in the last 12 months`);
  notes.push(
    input.medianPayDays === null
      ? "No paid invoices yet (neutral)"
      : `Pays in ${Math.round(input.medianPayDays * 10) / 10} days (median)`,
  );
  notes.push(
    answered === 0
      ? "No offers answered yet (neutral)"
      : `Accepted ${input.offersAccepted} of ${answered} offers` +
          (input.offersDeclined + input.offersExpired > 0
            ? ` (${input.offersDeclined} declined, ${input.offersExpired} no response)`
            : ""),
  );
  notes.push(`Account ${Math.max(0, input.tenureMonths)} month${input.tenureMonths === 1 ? "" : "s"} old`);

  return { total: spend + paymentSpeed + acceptance + tenure, spend, paymentSpeed, acceptance, tenure, notes };
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function wholeMonthsBetween(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// ── Quantities ────────────────────────────────────────────────────────────

/** Round down to a whole number of increments (never negative). */
export function floorToIncrement(qty: number, increment: number): number {
  const inc = Math.max(1, Math.floor(increment));
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.floor(Math.floor(qty) / inc) * inc;
}

export function isWholeIncrement(qty: number, increment: number): boolean {
  const inc = Math.max(1, Math.floor(increment));
  return Number.isInteger(qty) && qty > 0 && qty % inc === 0;
}

// ── Suggested split ───────────────────────────────────────────────────────

export type SplitCandidate = {
  accountId: string;
  score: number;
  /** Units this buyer still wants (before rounding to increments). */
  need: number;
  /** Stable tiebreak for equal scores: older accounts first, then id. */
  tiebreak: string;
};

export type SplitInput = {
  available: number;
  increment: number;
  /** Units the internal vending account wants (filled first). */
  internalNeed: number;
  candidates: SplitCandidate[];
};

export type SplitResult = {
  internalQty: number;
  allocations: { accountId: string; qty: number }[];
  /** Units left after everyone who could take a full increment was served. */
  leftover: number;
  /** Candidates who wanted something but less than one increment. */
  belowIncrement: string[];
};

export function orderCandidates<T extends { score: number; tiebreak: string; accountId: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tiebreak !== b.tiebreak) return a.tiebreak < b.tiebreak ? -1 : 1;
    return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
  });
}

/**
 * Turn-based fill (docs §5): internal first, then candidates take turns in
 * score order, one increment per turn, until stock or demand runs out.
 * Higher scores are served first on every pass, but nobody takes
 * everything while others with demand get nothing.
 */
export function suggestSplit(input: SplitInput): SplitResult {
  const inc = Math.max(1, Math.floor(input.increment));
  const available = Math.max(0, Math.floor(input.available));
  const internalQty = Math.min(floorToIncrement(input.internalNeed, inc), floorToIncrement(available, inc));

  let pool = floorToIncrement(available - internalQty, inc);
  const ordered = orderCandidates(input.candidates);
  const remaining = new Map<string, number>();
  const given = new Map<string, number>();
  const belowIncrement: string[] = [];
  for (const c of ordered) {
    const need = floorToIncrement(c.need, inc);
    if (need === 0 && c.need > 0) belowIncrement.push(c.accountId);
    remaining.set(c.accountId, (remaining.get(c.accountId) ?? 0) + need);
  }

  while (pool >= inc) {
    let progressed = false;
    for (const c of ordered) {
      if (pool < inc) break;
      const rem = remaining.get(c.accountId) ?? 0;
      if (rem < inc) continue;
      remaining.set(c.accountId, rem - inc);
      given.set(c.accountId, (given.get(c.accountId) ?? 0) + inc);
      pool -= inc;
      progressed = true;
    }
    if (!progressed) break;
  }

  const allocations = ordered
    .filter((c, i, arr) => arr.findIndex((x) => x.accountId === c.accountId) === i)
    .map((c) => ({ accountId: c.accountId, qty: given.get(c.accountId) ?? 0 }))
    .filter((a) => a.qty > 0);
  const allocated = allocations.reduce((s, a) => s + a.qty, 0);
  return { internalQty, allocations, leftover: available - internalQty - allocated, belowIncrement };
}

/** Owner edits: every quantity whole increments, and the total within stock. */
export function validatePlan(
  plan: { accountId: string; qty: number }[],
  available: number,
  increment: number,
): string | null {
  const seen = new Set<string>();
  let total = 0;
  for (const p of plan) {
    if (seen.has(p.accountId)) return "A buyer appears twice for the same product.";
    seen.add(p.accountId);
    if (p.qty === 0) continue;
    if (!isWholeIncrement(p.qty, increment)) {
      return increment > 1 ? `Quantities must be whole multiples of ${increment}.` : "Quantities must be whole numbers.";
    }
    total += p.qty;
  }
  if (total > available) return `That's ${total} units but only ${available} are available.`;
  return null;
}
