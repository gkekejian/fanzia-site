import { NextRequest, NextResponse } from "next/server";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { invoice, payment, account } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/**
 * Money customers still owe: sent/partial invoices with their remaining
 * balance (total minus all recorded payments, cleared or not) and how long
 * they've been outstanding. Fully-paid leftovers never appear here.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Viewing receivables");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      accountId: invoice.accountId,
      accountName: account.legalName,
      totalMinor: invoice.totalMinor,
      sentAt: invoice.sentAt,
      paidMinor: sql<number>`coalesce(sum(${payment.amountMinor}), 0)`.as("paid_minor"),
    })
    .from(invoice)
    .innerJoin(account, eq(account.id, invoice.accountId))
    .leftJoin(payment, eq(payment.invoiceId, invoice.id))
    .where(inArray(invoice.status, ["sent", "partial"]))
    .groupBy(invoice.id, account.id)
    .orderBy(invoice.sentAt);

  const now = Date.now();
  const receivables = rows
    .map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      accountId: r.accountId,
      accountName: r.accountName,
      totalMinor: r.totalMinor,
      paidMinor: r.paidMinor,
      remainingMinor: r.totalMinor - r.paidMinor,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      daysSinceSent: r.sentAt ? Math.floor((now - r.sentAt.getTime()) / (24 * 60 * 60 * 1000)) : null,
    }))
    .filter((r) => r.remainingMinor > 0);

  const totalRemainingMinor = receivables.reduce((sum, r) => sum + r.remainingMinor, 0);

  return NextResponse.json({ receivables, totalRemainingMinor });
}
