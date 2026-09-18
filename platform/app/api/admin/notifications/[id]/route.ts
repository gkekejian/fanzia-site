import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { markNotificationRead } from "@/lib/notifications";

/** Owner-only: mark one notification read. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Marking a notification read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marked = await markNotificationRead(db, params.id);
  if (!marked) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
