import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { cancelOrderRequest, InvoicingError } from "@/lib/invoicing/service";

/**
 * Buyer cancel of their own offer from "submitted" or "expired" — the
 * cancel-and-refund alternative path. No payment is ever taken at the
 * offer stage, so there is nothing to refund.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const json = await req.json().catch(() => null);
  const reason = typeof json?.reason === "string" ? json.reason : "";
  try {
    const cancelled = await cancelOrderRequest(
      db,
      params.id,
      {
        type: "buyer",
        buyer: {
          accountContactId: buyer.accountContactId,
          accountId: buyer.accountId,
          contactName: buyer.contactName,
          contactEmail: buyer.contactEmail,
          contactRole: buyer.contactRole,
        },
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      },
      { reason },
    );
    return NextResponse.json({ ok: true, orderRequest: { id: cancelled.id, status: cancelled.status } });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
