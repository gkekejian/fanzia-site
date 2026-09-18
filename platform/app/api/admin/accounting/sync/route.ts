import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { postPaymentsToCashbook } from "@/lib/accounting/cashbook";
import { clientIp } from "@/lib/rateLimit";

/**
 * Pull cleared payments into the cashbook. Safe to run any time — already
 * posted payments are skipped, so this never double-counts.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Syncing payments to the cashbook");
    ownerId = actor.user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const posted = await postPaymentsToCashbook();
  const ip = clientIp(req.headers);

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "cashbook.synced",
    entityType: "accounting",
    after: { posted },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, posted });
}
