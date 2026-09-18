import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { confirmWirePayment, InvoicingError } from "@/lib/invoicing/service";

/** Owner confirms a wire arrived: funds clear now. */
export async function POST(req: NextRequest, { params }: { params: { id: string; paymentId: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Confirming a wire payment");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerId = actorUserId(actor);
  try {
    const { payment, invoice } = await confirmWirePayment(db, params.paymentId);
    await recordAudit({
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "invoice.wire_confirmed",
      entityType: "payment",
      entityId: payment.id,
      after: { invoiceId: invoice.id, invoiceStatus: invoice.status },
    });
    return NextResponse.json({ ok: true, payment, invoice });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
