import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { markAllNotificationsRead } from "@/lib/notifications";

/** Owner-only: mark every unread notification read. */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Marking notifications read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marked = await markAllNotificationsRead(db);
  return NextResponse.json({ ok: true, marked });
}
