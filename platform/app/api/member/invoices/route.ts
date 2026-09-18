import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoice, payment } from "@/db/schema";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { balanceDue } from "@/lib/invoicing/rules";

/** The buyer's own invoices, with remaining balances. */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const invoices = await db
    .select()
    .from(invoice)
    .where(eq(invoice.accountId, buyer.accountId))
    .orderBy(desc(invoice.createdAt))
    .limit(200);

  const rows = await Promise.all(
    invoices.map(async (inv) => {
      const payments = await db.select().from(payment).where(eq(payment.invoiceId, inv.id));
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        totalMinor: inv.totalMinor,
        balanceMinor: balanceDue(inv.totalMinor, payments),
        status: inv.status,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
      };
    }),
  );

  return NextResponse.json({ invoices: rows });
}
