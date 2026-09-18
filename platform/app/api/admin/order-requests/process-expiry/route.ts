import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { processExpiredOffers } from "@/lib/invoicing/service";

/**
 * Owner-triggered expiry sweep: runs every stale submitted offer through
 * the rollover policy (first expiry → one automatic silent rollover;
 * later expiry → marked expired, no silent rollover). Audit-logged as one
 * sweep entry plus the per-offer system entries written by the service.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Running the offer expiry check");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerId = actorUserId(actor);
  const { rolledOver, expired } = await processExpiredOffers(db);
  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "order_request.expiry_sweep",
    entityType: "order_request",
    after: { rolledOver, expired },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, rolledOver, expired });
}
