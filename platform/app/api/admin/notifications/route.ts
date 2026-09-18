import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { countUnreadNotifications, listNotifications } from "@/lib/notifications";

/** Owner-only: newest-first notification list + unread count (drives the nav bell). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing notifications");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));
  const [notifications, unreadCount] = await Promise.all([
    listNotifications(db, { unreadOnly, limit }),
    countUnreadNotifications(db),
  ]);
  return NextResponse.json({ notifications, unreadCount });
}
