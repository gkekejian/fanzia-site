import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { recordAudit } from "@/lib/audit";
import { areApplicationsOpen, setApplicationsOpen } from "@/lib/applications/portal";

/**
 * Owner-only kill switch for the wholesale application portal
 * (owner directive 2026-09-23).
 *
 * GET  -> { open: boolean }
 * POST -> { open: boolean } with body { open: boolean }
 *
 * Closing stops NEW applications (/apply page + POST /api/applications);
 * in-flight applications (resume links, document uploads, review queue)
 * keep working. Reopening is the owner's explicit call.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  return NextResponse.json({ open: await areApplicationsOpen() });
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const open = json?.open;
  if (typeof open !== "boolean") {
    return NextResponse.json({ error: "Body must be { open: boolean }." }, { status: 400 });
  }

  const before = await areApplicationsOpen();
  await setApplicationsOpen(open);
  await recordAudit({
    actorUserId: actor.user.id,
    actorRole: "owner",
    actorType: "owner",
    action: open ? "portal.applications_opened" : "portal.applications_closed",
    entityType: "setting",
    entityId: "applications_open",
    before: { open: before },
    after: { open },
  });

  return NextResponse.json({ open });
}
