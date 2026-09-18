import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { recordAudit } from "@/lib/audit";
import { notifyOwners } from "@/lib/notifications";
import { formatMoney } from "@/lib/format";
import { OFFER_EXPIRY_HOURS } from "@/lib/invoicing/rules";
import { submitDraftRequest, InvoicingError } from "@/lib/invoicing/service";

/**
 * Submit the buyer's draft as an order request: prices are snapshotted,
 * the $500 minimum is enforced, the $25 small-order fee (when under $750)
 * is disclosed and applied, and the offer expires 48 hours later.
 * The draft is cleared on success.
 */
export async function POST(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  try {
    const created = await submitDraftRequest(db, buyer);

    await recordAudit({
      actorType: "buyer",
      action: "order_request.submitted",
      entityType: "order_request",
      entityId: created.id,
      after: {
        accountId: buyer.accountId,
        contactId: buyer.accountContactId,
        subtotalMinor: created.subtotalMinor,
        smallOrderFeeMinor: created.smallOrderFeeMinor,
      },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    await notifyOwners(
      "New order request submitted",
      `${buyer.contactName} (${buyer.contactEmail}) submitted an order request: ` +
        `${formatMoney(created.subtotalMinor)} subtotal` +
        (created.smallOrderFeeMinor ? ` + ${formatMoney(created.smallOrderFeeMinor)} small-order fee` : "") +
        `. The offer expires in ${OFFER_EXPIRY_HOURS} hours.\n\n` +
        `Review: ${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/order-requests/${created.id}`,
    );

    return NextResponse.json({
      ok: true,
      orderRequestId: created.id,
      subtotalMinor: created.subtotalMinor,
      smallOrderFeeMinor: created.smallOrderFeeMinor,
      expiresAt: created.expiresAt,
    });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
