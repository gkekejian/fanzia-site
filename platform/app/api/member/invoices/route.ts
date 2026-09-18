import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoice, payment, shipment } from "@/db/schema";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { balanceDue } from "@/lib/invoicing/rules";

/** The buyer's own invoices, with remaining balances and latest shipment. */
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
      const [latestShipment] = await db
        .select()
        .from(shipment)
        .where(eq(shipment.invoiceId, inv.id))
        .orderBy(desc(shipment.createdAt))
        .limit(1);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        totalMinor: inv.totalMinor,
        balanceMinor: balanceDue(inv.totalMinor, payments),
        status: inv.status,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
        shipment: latestShipment
          ? {
              status: latestShipment.status,
              carrier: latestShipment.carrier,
              trackingNumber: latestShipment.trackingNumber,
              shippedAt: latestShipment.shippedAt,
              deliveredAt: latestShipment.deliveredAt,
            }
          : null,
      };
    }),
  );

  return NextResponse.json({ invoices: rows });
}
