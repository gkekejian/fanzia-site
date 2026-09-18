import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, actorUserId } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { sendNotificationEmail } from "@/lib/email/send";
import { runOpsSweep } from "@/lib/expiry/sweep";

/**
 * Owner-triggered ops sweep: runs the same shared sweep as the daily cron
 * (stale-offer expiry through the rollover policy, final-expiry buyer
 * emails, 24h pre-expiry nudges, and the dunning / resale-doc /
 * proposal-staleness companion sweeps). Audit-logged as one sweep entry
 * plus the per-offer system entries written by the service.
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
  const result = await runOpsSweep(db, {
    sendEmail: (params) => sendNotificationEmail(params, "ops-sweep"),
    baseUrl: process.env.APP_BASE_URL ?? "https://app.fanzia.io",
    now: new Date(),
  });
  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "order_request.expiry_sweep",
    entityType: "order_request",
    after: {
      rolledOver: result.rolledOver,
      expired: result.expired,
      finalExpirySent: result.finalExpirySent,
      nudgesSent: result.nudgesSent,
      dunning: result.dunning,
      resaleDocs: result.resaleDocs,
      proposalNudges: result.proposalNudges,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({
    ok: true,
    rolledOver: result.rolledOver,
    expired: result.expired,
    finalExpirySent: result.finalExpirySent,
    nudgesSent: result.nudgesSent,
    dunning: result.dunning,
    resaleDocs: result.resaleDocs,
    proposalNudges: result.proposalNudges,
  });
}
