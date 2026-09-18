import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/format";
import { recordInvoicePayment, InvoicingError } from "@/lib/invoicing/service";

/**
 * Record a manual payment against an invoice. No live processor exists —
 * owners record card/ACH/wire payments here; funds_cleared_at is computed
 * at record time (wire stays NULL until confirmed).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Recording a payment");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const ownerId = actorUserId(actor);

  try {
    const { payment, invoice } = await recordInvoicePayment(db, params.id, ownerId, {
      amountMinor: json?.amountMinor,
      method: json?.method,
      reference: typeof json?.reference === "string" ? json.reference : undefined,
      paidAt: typeof json?.paidAt === "string" ? new Date(json.paidAt) : undefined,
    });
    await recordAudit({
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "invoice.payment_recorded",
      entityType: "payment",
      entityId: payment.id,
      after: {
        invoiceId: invoice.id,
        amountMinor: payment.amountMinor,
        method: payment.method,
        fundsClearedAt: payment.fundsClearedAt,
        invoiceStatus: invoice.status,
      },
    });
    return NextResponse.json({
      ok: true,
      payment,
      invoice,
      clearedNote:
        payment.fundsClearedAt === null
          ? "Wire recorded — funds clear only when an owner confirms receipt."
          : `Funds clear ${new Date(payment.fundsClearedAt).toLocaleDateString("en-US")}.`,
      amountNote: `${formatMoney(payment.amountMinor)} recorded against ${invoice.invoiceNumber}.`,
    });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
