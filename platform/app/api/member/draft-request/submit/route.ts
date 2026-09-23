import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { recordAudit } from "@/lib/audit";
import { notifyOwnersEvent } from "@/lib/notifications";
import { formatMoney } from "@/lib/format";
import { OFFER_EXPIRY_HOURS } from "@/lib/invoicing/rules";
import { submitDraftRequest, InvoicingError } from "@/lib/invoicing/service";
import { autoApproveIfEligible, type AutoApproveResult } from "@/lib/invoicing/autoApprove";
import { clientIp, rateLimited, PUBLIC_WRITE_LIMITS } from "@/lib/rateLimit";
import { verifyTurnstile, turnstileFailureBody } from "@/lib/turnstile";

/**
 * Submit the buyer's draft as an order request: prices are snapshotted,
 * the $500 minimum is enforced, the $25 small-order fee (when under $750)
 * is disclosed and applied, and the offer expires 48 hours later.
 * The draft is cleared on success.
 */
export async function POST(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  // Bot/abuse defense: per-buyer-account + IP rate limit (an approved buyer
  // account could still be scripted), plus Turnstile when configured.
  const ip = clientIp(req.headers);
  const limited = await rateLimited(`draft-submit:${buyer.accountId}:${ip}`, PUBLIC_WRITE_LIMITS.draftRequestSubmit);
  if (limited) return limited;

  const json = await req.json().catch(() => null);

  const turnstile = await verifyTurnstile(
    typeof json?.turnstileToken === "string" ? json.turnstileToken : null,
    ip,
  );
  if (!turnstile.ok) {
    return NextResponse.json(turnstileFailureBody(), { status: 403 });
  }

  try {
    const created = await submitDraftRequest(db, buyer, {
      importAcknowledged: json?.importAcknowledged === true,
    });

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
        importAcknowledged: json?.importAcknowledged === true,
      },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    // Routine repeat orders skip the owner queue entirely. Failures here
    // must never fail the buyer's submit: the request is already saved and
    // simply falls back to manual review.
    let auto: AutoApproveResult = { approved: false, reason: "not attempted" };
    try {
      auto = await autoApproveIfEligible(db, created.id);
    } catch (err) {
      console.error("[draft-submit] auto-approve failed; left for manual review:", err);
    }

    await notifyOwnersEvent(
      {
        type: "order_placed",
        title: auto.approved
          ? `Order auto-approved — ${buyer.contactName} (${auto.invoiceNumber})`
          : `New order request — ${buyer.contactName}`,
        body:
          `${buyer.contactName} (${buyer.contactEmail}) submitted an order request: ` +
          `${formatMoney(created.subtotalMinor)} subtotal` +
          (created.smallOrderFeeMinor ? ` + ${formatMoney(created.smallOrderFeeMinor)} small-order fee` : "") +
          (auto.approved
            ? `. Auto-approved and invoiced; no action needed.\n\n`
            : `. Needs review (${auto.reason}). The offer expires in ${OFFER_EXPIRY_HOURS} hours.\n\n`) +
          `Review: ${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/order-requests/${created.id}`,
        actorEmail: buyer.contactEmail,
        entityType: "order_request",
        entityId: created.id,
      },
      db,
    );

    return NextResponse.json({
      ok: true,
      orderRequestId: created.id,
      subtotalMinor: created.subtotalMinor,
      smallOrderFeeMinor: created.smallOrderFeeMinor,
      expiresAt: created.expiresAt,
      autoApproved: auto.approved,
      invoiceId: auto.approved ? auto.invoiceId : null,
    });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
