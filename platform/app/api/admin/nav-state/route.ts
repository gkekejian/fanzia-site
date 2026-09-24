import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { loadConfig, MODULE_KEYS } from "@/lib/config";
import { countUnreadNotifications } from "@/lib/notifications";
import { getActionQueue } from "@/lib/ops/today";

/**
 * One small call per admin page load for the nav: unread bell count, how
 * many things are waiting on the Today page, and which optional modules
 * are on (so switched-off modules disappear from the menu).
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Navigation");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [config, unread, queue] = await Promise.all([
    loadConfig(db),
    countUnreadNotifications(db).catch(() => 0),
    getActionQueue(db).catch(() => []),
  ]);
  return NextResponse.json({
    unreadCount: unread,
    todayCount: queue.length,
    todayUrgent: queue.filter((q) => q.severity === "urgent").length,
    modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, config[k]])),
    orderingPaused: config.ordering_paused,
  });
}
