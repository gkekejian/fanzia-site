import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { computeKpis } from "@/lib/analytics/kpis";

/** Owner-only KPIs. ?days=7|30|90|365 (default 30). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Analytics");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  return NextResponse.json(await computeKpis(db, { days: Number.isFinite(days) ? days : 30 }));
}
