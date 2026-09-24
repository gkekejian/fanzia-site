import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

/**
 * Owner-only ordering hold. Body: { hold: true, reason: string } or { hold: false }.
 * Holds are set automatically on a card dispute; lifting one is always a
 * deliberate owner action.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Changing an ordering hold");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => ({}));
  if (typeof json?.hold !== "boolean") return NextResponse.json({ error: "Body must include hold: boolean." }, { status: 400 });
  const reason = typeof json.reason === "string" ? json.reason.trim().slice(0, 300) : "";
  if (json.hold && !reason) return NextResponse.json({ error: "A reason is required to place a hold." }, { status: 400 });

  const [before] = await db.select().from(account).where(eq(account.id, params.id)).limit(1);
  if (!before) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  await db
    .update(account)
    .set(json.hold ? { orderingHoldReason: reason, orderingHoldAt: new Date() } : { orderingHoldReason: null, orderingHoldAt: null })
    .where(eq(account.id, params.id));
  await recordAudit({
    actorUserId: actor.user.id,
    actorRole: "owner",
    actorType: "owner",
    action: json.hold ? "account.hold_placed" : "account.hold_lifted",
    entityType: "account",
    entityId: params.id,
    before: { orderingHoldReason: before.orderingHoldReason },
    after: { orderingHoldReason: json.hold ? reason : null },
  });
  return NextResponse.json({ ok: true });
}
