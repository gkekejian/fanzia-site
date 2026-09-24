import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { runHealthChecks } from "@/lib/ops/health";

/**
 * Owner-only full health report: database, schema/migrations, daily-job
 * heartbeat, email delivery, payments, refunds, expiring orders, holds,
 * and which integrations are configured. Surfaced in /admin/system-status.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Database health check");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }
  return NextResponse.json(await runHealthChecks(db));
}
