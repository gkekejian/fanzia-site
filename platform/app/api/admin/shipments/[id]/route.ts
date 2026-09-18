import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import {
  markShipmentShipped,
  markShipmentDelivered,
  cancelShipment,
  InvoicingError,
} from "@/lib/invoicing/fulfillment";

/**
 * Shipment lifecycle actions (owner only).
 * POST body: { action: 'ship' } | { action: 'deliver' } | { action: 'cancel', reason? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Updating a shipment");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const ownerId = actorUserId(actor);
  try {
    const action = json?.action;
    if (action === "ship") {
      const updated = await markShipmentShipped(db, params.id, ownerId);
      return NextResponse.json({ ok: true, shipment: updated });
    }
    if (action === "deliver") {
      const updated = await markShipmentDelivered(db, params.id, ownerId);
      return NextResponse.json({ ok: true, shipment: updated });
    }
    if (action === "cancel") {
      const updated = await cancelShipment(db, params.id, ownerId, json?.reason);
      return NextResponse.json({ ok: true, shipment: updated });
    }
    return NextResponse.json({ error: "Provide action ('ship'|'deliver'|'cancel')." }, { status: 400 });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
