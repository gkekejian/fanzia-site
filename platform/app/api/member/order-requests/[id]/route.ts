import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orderRequest } from "@/db/schema";
import { requireBuyer } from "@/lib/auth/buyerActor";

/**
 * Buyer view of one of their own order requests. Returns a buyer-safe
 * DTO: snapshotted line prices and totals only — never supplier identity,
 * terms, costs, or Fanzia markup (none of which exist on this table).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, params.id)).limit(1);
  if (!row || row.accountId !== buyer.accountId) {
    return NextResponse.json({ error: "Order request not found." }, { status: 404 });
  }

  const lines = (row.lines ?? []) as {
    productId: string;
    sku: string;
    name: string;
    qtyRequested: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    currencyCode: string;
  }[];

  return NextResponse.json({
    orderRequest: {
      id: row.id,
      status: row.status,
      lines: lines.map((l) => ({
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        qtyRequested: l.qtyRequested,
        unitPriceMinor: l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor,
        currencyCode: l.currencyCode,
      })),
      notes: row.notes,
      subtotalMinor: row.subtotalMinor,
      smallOrderFeeMinor: row.smallOrderFeeMinor ?? 0,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      rolloverCount: row.rolloverCount ?? 0,
      lastRolledOverAt: row.lastRolledOverAt,
      supersedesId: row.supersedesId,
    },
  });
}
