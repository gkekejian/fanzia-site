import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { cancelOrderRequest, InvoicingError } from "@/lib/invoicing/service";

/**
 * Owner cancel of an order request from "submitted" or "expired" — the
 * cancel-and-refund alternative path. No payment is ever taken at the
 * offer stage, so nothing is owed back; the audit entry records that.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Cancelling an order request");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const reason = typeof json?.reason === "string" ? json.reason : "";
  try {
    const cancelled = await cancelOrderRequest(
      db,
      params.id,
      {
        type: "owner",
        ownerId: actorUserId(actor),
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      },
      { reason },
    );
    return NextResponse.json({ ok: true, orderRequest: cancelled });
  } catch (err) {
    if (err instanceof InvoicingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
