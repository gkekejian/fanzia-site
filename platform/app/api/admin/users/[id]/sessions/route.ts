import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable, session as sessionTable } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** Session visibility for staff users — owner-only. Lets owners spot and kill stray logins. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing staff sessions");
  } catch {
    return forbidden();
  }

  const target = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, params.id)).limit(1);
  if (!target[0]) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const sessions = await db
    .select({
      id: sessionTable.id,
      ip: sessionTable.ip,
      userAgent: sessionTable.userAgent,
      expiresAt: sessionTable.expiresAt,
      revokedAt: sessionTable.revokedAt,
      createdAt: sessionTable.createdAt,
    })
    .from(sessionTable)
    .where(eq(sessionTable.userId, params.id))
    .orderBy(desc(sessionTable.createdAt))
    .limit(50);
  return NextResponse.json({ sessions });
}

/** Revoke one session (?sessionId=) or every live session for the user. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Revoking staff sessions");
    ownerId = actor.user.id;
  } catch {
    return forbidden();
  }

  const target = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, params.id)).limit(1);
  if (!target[0]) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (sessionId) {
    await db
      .update(sessionTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionTable.id, sessionId));
  } else {
    await db
      .update(sessionTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionTable.userId, params.id));
  }
  const ip = clientIp(req.headers);
  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "staff_user.sessions_revoked",
    entityType: "user",
    entityId: params.id,
    after: sessionId ? { sessionId } : { all: true },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
