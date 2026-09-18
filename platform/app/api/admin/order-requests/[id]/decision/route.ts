import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { notifyOwners } from "@/lib/notifications";
import { formatMoney } from "@/lib/format";
import {
  approveOrderRequest,
  declineOrderRequest,
  InvoicingError,
} from "@/lib/invoicing/service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Deciding an order request");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const decision = json?.decision;
  if (decision !== "approve" && decision !== "decline") {
    return NextResponse.json({ error: "decision must be 'approve' or 'decline'." }, { status: 400 });
  }

  const ownerId = actorUserId(actor);
  try {
    if (decision === "decline") {
      const declined = await declineOrderRequest(db, params.id, ownerId, String(json?.declineReason ?? ""));
      await recordAudit({
        actorUserId: ownerId,
        actorRole: "owner",
        actorType: "owner",
        action: "order_request.declined",
        entityType: "order_request",
        entityId: declined.id,
        after: { reason: declined.declineReason },
      });
      return NextResponse.json({ ok: true, orderRequest: declined });
    }

    const { request, invoice } = await approveOrderRequest(db, params.id, ownerId);
    await recordAudit({
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "order_request.approved",
      entityType: "order_request",
      entityId: request.id,
      after: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor },
    });
    await notifyOwners(
      "Order request approved — invoice drafted",
      `Order request for ${formatMoney(invoice.totalMinor)} was approved. ` +
        `Invoice ${invoice.invoiceNumber} is in draft status (tax defaults to $0.00 — adjust before sending).\n\n` +
        `Review: ${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/invoices/${invoice.id}`,
    );
    return NextResponse.json({ ok: true, orderRequest: request, invoice });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
