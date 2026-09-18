import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { createShipment, InvoicingError } from "@/lib/invoicing/fulfillment";

/** Create a shipment for an invoice (owner only). Body: { carrier, trackingNumber, notes? } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Creating a shipment");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  try {
    const created = await createShipment(db, params.id, actorUserId(actor), {
      carrier: json?.carrier,
      trackingNumber: json?.trackingNumber,
      notes: json?.notes,
    });
    return NextResponse.json({ ok: true, shipment: created });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
