import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { reacceptExpiredOffer, InvoicingError } from "@/lib/invoicing/service";

/**
 * Explicit buyer reacceptance of an expired offer: shows the buyer the
 * terms and requires their deliberate action — never implied. Creates a
 * fresh 48-hour offer version (audit-logged, actor=buyer).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  try {
    const fresh = await reacceptExpiredOffer(
      db,
      params.id,
      {
        accountContactId: buyer.accountContactId,
        accountId: buyer.accountId,
        contactName: buyer.contactName,
        contactEmail: buyer.contactEmail,
        contactRole: buyer.contactRole,
      },
      {
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      },
    );
    return NextResponse.json({
      ok: true,
      orderRequestId: fresh.id,
      expiresAt: fresh.expiresAt,
      subtotalMinor: fresh.subtotalMinor,
      smallOrderFeeMinor: fresh.smallOrderFeeMinor ?? 0,
    });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
