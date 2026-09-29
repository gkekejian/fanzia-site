import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { payment, refundDue } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { refundCardPayment } from "@/lib/invoicing/stripe";
import { markLateOfferInvoiceRefunded } from "@/lib/allocation/fromInvoices";

/**
 * Owner-only: refund a pending/failed refund to the buyer's card through
 * Stripe. Same idempotency key as the automatic path, so a double tap or a
 * retry after a timeout can never refund twice.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Refunding to card");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [row] = await db
    .select()
    .from(refundDue)
    .where(and(eq(refundDue.id, params.id), inArray(refundDue.status, ["pending", "failed"])))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Refund not found or already resolved." }, { status: 404 });

  const [card] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.invoiceId, row.invoiceId), eq(payment.method, "card")))
    .orderBy(desc(payment.amountMinor))
    .limit(1);
  if (!card?.reference || card.amountMinor < row.amountMinor) {
    return NextResponse.json({ error: "No card payment on this invoice covers the refund. Pay it back by ACH/wire and mark it refunded." }, { status: 400 });
  }
  try {
    const refund = await refundCardPayment({ paymentIntentId: card.reference, amountMinor: row.amountMinor, idempotencyKey: `refund_due_${row.id}` });
    await db
      .update(refundDue)
      .set({ status: "refunded", method: "card", stripeRefundId: refund.id, resolvedBy: actor.user.id, resolvedAt: new Date(), lastError: null })
      .where(eq(refundDue.id, row.id));
    await markLateOfferInvoiceRefunded(db, row.invoiceId);
    await recordAudit({ actorUserId: actor.user.id, actorRole: "owner", actorType: "owner", action: "refund_due.card_refunded", entityType: "refund_due", entityId: row.id, after: { stripeRefundId: refund.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await db.update(refundDue).set({ status: "failed", lastError: message }).where(eq(refundDue.id, row.id));
    return NextResponse.json({ error: `Stripe refused the refund: ${message}` }, { status: 502 });
  }
}
