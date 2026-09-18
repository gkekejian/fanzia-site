import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { cashbookEntry, payment, invoice } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type CashbookRow = typeof cashbookEntry.$inferSelect;

/** Totals for a set of cashbook rows, in minor units. */
export function totalsByDirection(entries: Pick<CashbookRow, "direction" | "amountMinor">[]): {
  inMinor: number;
  outMinor: number;
  balanceMinor: number;
} {
  let inMinor = 0;
  let outMinor = 0;
  for (const e of entries) {
    if (e.direction === "in") inMinor += e.amountMinor;
    else outMinor += e.amountMinor;
  }
  return { inMinor, outMinor, balanceMinor: inMinor - outMinor };
}

/**
 * Attach a running balance to each row. Input order doesn't matter — rows
 * are sorted oldest-first (entry date, then creation order) before the
 * balance is accumulated, so the result is chronological.
 */
export function runningBalance(entries: CashbookRow[]): (CashbookRow & { runningBalanceMinor: number })[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
    return a.id < b.id ? -1 : 1;
  });
  let balance = 0;
  return sorted.map((e) => {
    balance += e.direction === "in" ? e.amountMinor : -e.amountMinor;
    return { ...e, runningBalanceMinor: balance };
  });
}

/** Validate a manual cashbook entry from the API. Returns an error message or null. */
export function validateManualEntry(input: {
  entryDate?: unknown;
  direction?: unknown;
  amountMinor?: unknown;
  category?: unknown;
}): string | null {
  if (typeof input.entryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    return "entryDate must be a YYYY-MM-DD date.";
  }
  if (input.direction !== "in" && input.direction !== "out") {
    return "direction must be 'in' or 'out'.";
  }
  if (!Number.isInteger(input.amountMinor) || (input.amountMinor as number) <= 0) {
    return "amountMinor must be a positive whole number of cents.";
  }
  const valid = ["invoice_payment", "refund", "expense", "adjustment", "owner_contribution"];
  if (typeof input.category !== "string" || !valid.includes(input.category)) {
    return `category must be one of: ${valid.join(", ")}.`;
  }
  return null;
}

/**
 * Post every cleared payment that doesn't have a cashbook row yet. Cleared
 * means funds_cleared_at is set — pending card auths and unconfirmed wires
 * stay out of the cashbook until the money is really in. Idempotent: the
 * left join skips already-posted payments, and the unique partial index on
 * (reference_type, reference_id) is a backstop, so re-running never
 * double-counts.
 *
 * Returns the number of entries newly posted.
 */
export async function postPaymentsToCashbook(db: AnyDb = defaultDb): Promise<number> {
  const unposted = await db
    .select({
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      method: payment.method,
      paidAt: payment.paidAt,
      invoiceNumber: invoice.invoiceNumber,
    })
    .from(payment)
    .leftJoin(
      cashbookEntry,
      and(
        eq(cashbookEntry.referenceType, "payment"),
        // reference_id is text; cast the uuid so the comparison works in Postgres.
        sql`${cashbookEntry.referenceId} = ${payment.id}::text`,
      ),
    )
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .where(and(isNotNull(payment.fundsClearedAt), isNull(cashbookEntry.id)));

  if (unposted.length === 0) return 0;

  const rows = unposted.map((p) => ({
    entryDate: p.paidAt.toISOString().slice(0, 10),
    direction: "in" as const,
    amountMinor: p.amountMinor,
    category: "invoice_payment" as const,
    referenceType: "payment",
    referenceId: p.paymentId,
    notes: `Payment for invoice ${p.invoiceNumber} (${p.method})`,
    createdBy: null,
  }));

  // onConflictDoNothing is a second layer of idempotency on top of the
  // left-join filter above; the partial unique index makes it safe.
  await db.insert(cashbookEntry).values(rows).onConflictDoNothing();
  return unposted.length;
}

export type UnpaidInvoiceRow = {
  totalMinor: number;
  paidMinor: number;
  sentAt: Date | null;
};

/**
 * Aggregate receivables math shared by the summary and receivables routes:
 * remaining = total − all recorded payments (cleared or not — what the
 * customer still owes doesn't depend on funds clearance). "Overdue" is a
 * house rule here: sent 30+ days ago and still carrying a balance.
 */
export function summarizeReceivables(rows: UnpaidInvoiceRow[], now: Date = new Date()) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let receivablesMinor = 0;
  let overdueCount = 0;
  let count = 0;
  for (const r of rows) {
    const remainingMinor = r.totalMinor - r.paidMinor;
    if (remainingMinor <= 0) continue;
    count += 1;
    receivablesMinor += remainingMinor;
    if (r.sentAt && r.sentAt < thirtyDaysAgo) overdueCount += 1;
  }
  return { receivablesMinor, overdueCount, count };
}
