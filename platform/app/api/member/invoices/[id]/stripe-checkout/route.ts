import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { recordAudit } from "@/lib/audit";
import { createCardCheckout, InvoicingError } from "@/lib/invoicing/stripe";

/**
 * Create a Stripe Checkout Session (card only) for the invoice's remaining
 * balance. Test-mode ready; no keys are hardcoded — without
 * STRIPE_SECRET_KEY this returns 503 and buyers use manual methods.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  try {
    const { url, sessionId, amountMinor } = await createCardCheckout(db, buyer, params.id);
    await recordAudit({
      actorType: "buyer",
      action: "invoice.stripe_checkout_created",
      entityType: "invoice",
      entityId: params.id,
      after: { accountId: buyer.accountId, contactId: buyer.accountContactId, sessionId, amountMinor },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
