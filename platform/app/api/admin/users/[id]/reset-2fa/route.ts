import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable, totpCredential, recoveryCode } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Owner escape hatch: clear a staff user's TOTP credential and all of
 * their recovery codes. Use when someone loses BOTH their authenticator
 * and their recovery codes — self-service recovery is impossible then,
 * because minting new codes requires proving authenticator possession.
 *
 * After the reset the user signs in with a fresh magic link and is sent
 * through /admin/totp-setup to re-enroll, exactly like a first login.
 * Existing sessions are NOT revoked here — use "Revoke all sessions" on
 * the Users page as well if the authenticator may be compromised.
 * Owner-only and audit-logged.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Resetting a staff user's two-factor authentication");
    ownerId = actor.user.id;
  } catch {
    return forbidden();
  }

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`admin-user-reset-2fa:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const rows = await db.select().from(userTable).where(eq(userTable.id, params.id)).limit(1);
  const target = rows[0];
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await db.delete(totpCredential).where(eq(totpCredential.userId, target.id));
  await db.delete(recoveryCode).where(eq(recoveryCode.userId, target.id));

  await recordAudit({
    actorUserId: ownerId,
    actorRole: actor.user.role,
    actorType: "owner",
    action: "admin.user_2fa_reset",
    entityType: "user",
    entityId: target.id,
    after: { email: target.email },
    ip,
  });

  return NextResponse.json({ ok: true });
}
