import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import {
  getInvoiceDetail,
  sendInvoice,
  voidInvoice,
  setInvoiceTax,
  InvoicingError,
} from "@/lib/invoicing/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Viewing an invoice");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const detail = await getInvoiceDetail(db, params.id);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/**
 * PATCH body: { action: 'send' } | { action: 'void' } | { taxMinor: number }
 * (taxMinor may be combined with no action, or sent alone on a draft.)
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Updating an invoice");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const ownerId = actorUserId(actor);

  try {
    if (typeof json?.taxMinor === "number") {
      const updated = await setInvoiceTax(db, params.id, json.taxMinor);
      await recordAudit({
        actorUserId: ownerId,
        actorRole: "owner",
        actorType: "owner",
        action: "invoice.tax_adjusted",
        entityType: "invoice",
        entityId: updated.id,
        after: { taxMinor: updated.taxMinor, totalMinor: updated.totalMinor },
      });
      return NextResponse.json({ ok: true, invoice: updated });
    }

    const action = json?.action;
    if (action === "send") {
      const updated = await sendInvoice(db, params.id);
      await recordAudit({
        actorUserId: ownerId,
        actorRole: "owner",
        actorType: "owner",
        action: "invoice.sent",
        entityType: "invoice",
        entityId: updated.id,
      });
      return NextResponse.json({ ok: true, invoice: updated });
    }
    if (action === "void") {
      const updated = await voidInvoice(db, params.id);
      await recordAudit({
        actorUserId: ownerId,
        actorRole: "owner",
        actorType: "owner",
        action: "invoice.voided",
        entityType: "invoice",
        entityId: updated.id,
      });
      return NextResponse.json({ ok: true, invoice: updated });
    }
    return NextResponse.json({ error: "Provide action ('send'|'void') or taxMinor." }, { status: 400 });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
