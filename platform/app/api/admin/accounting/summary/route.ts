import { NextRequest, NextResponse } from "next/server";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { cashbookEntry, invoice, payment } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { totalsByDirection, summarizeReceivables } from "@/lib/accounting/cashbook";

/**
 * Operational snapshot: cash position from the cashbook plus what customers
 * still owe. "Overdue" means a sent invoice unpaid 30+ days — a house rule
 * for this simple cashbook, not a legal term; the invoice itself carries no
 * due date.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Accounting summary");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await db.select().from(cashbookEntry);
  const totals = totalsByDirection(entries);

  const unpaid = await db
    .select({
      totalMinor: invoice.totalMinor,
      sentAt: invoice.sentAt,
      paidMinor: sql<number>`coalesce(sum(${payment.amountMinor}), 0)`.as("paid_minor"),
    })
    .from(invoice)
    .leftJoin(payment, eq(payment.invoiceId, invoice.id))
    .where(inArray(invoice.status, ["sent", "partial"]))
    .groupBy(invoice.id);

  const { receivablesMinor, overdueCount } = summarizeReceivables(unpaid);

  return NextResponse.json({
    balanceMinor: totals.balanceMinor,
    inMinor: totals.inMinor,
    outMinor: totals.outMinor,
    receivablesMinor,
    overdueCount,
  });
}
