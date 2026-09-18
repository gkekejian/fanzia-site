import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable, session as sessionTable } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

async function loadTarget(id: string) {
  const rows = await db.select().from(userTable).where(eq(userTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Activate/deactivate a staff user. Deactivation also revokes every live
 * session immediately. Guards: nobody deactivates themselves, and the last
 * active owner can never be deactivated (the platform must always have an
 * owner who can sign in).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Changing a staff user's status");
    ownerId = actor.user.id;
  } catch {
    return forbidden();
  }

  const target = await loadTarget(params.id);
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const json = await req.json().catch(() => null);
  if (typeof json?.active !== "boolean") {
    return NextResponse.json({ error: "The 'active' field must be a boolean." }, { status: 400 });
  }
  if (json.active === target.active) return NextResponse.json({ ok: true, active: target.active });

  if (!json.active && target.id === ownerId) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }
  if (!json.active && target.role === "owner") {
    const [{ value: activeOwners } = { value: 0 }] = await db
      .select({ value: count() })
      .from(userTable)
      .where(and(eq(userTable.role, "owner"), eq(userTable.active, true)));
    if (activeOwners <= 1) {
      return NextResponse.json({ error: "This is the last active owner. The platform must always have an owner." }, { status: 400 });
    }
  }

  await db.update(userTable).set({ active: json.active, updatedAt: new Date() }).where(eq(userTable.id, target.id));
  if (!json.active) {
    await db.update(sessionTable).set({ revokedAt: new Date() }).where(eq(sessionTable.userId, target.id));
  }

  const ip = clientIp(req.headers);
  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: json.active ? "staff_user.reactivated" : "staff_user.deactivated",
    entityType: "user",
    entityId: target.id,
    before: { active: target.active },
    after: { active: json.active },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, active: json.active });
}
