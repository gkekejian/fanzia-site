import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { totpCredential, recoveryCode, user as userTable } from "@/db/schema";
import { verifyMfaPendingToken, MFA_PENDING_COOKIE } from "@/lib/auth/mfaPending";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret, hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Second half of a returning owner's login: the magic link already proved
 * email possession; this proves possession of the TOTP device (or a
 * one-time recovery code) before a real session is issued. The MFA-pending
 * cookie is stateless and short-lived (lib/auth/mfaPending.ts) — losing it
 * just means starting the magic-link flow again, no cleanup required.
 */
export async function POST(req: NextRequest) {
  const pending = verifyMfaPendingToken(req.cookies.get(MFA_PENDING_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: "Sign-in session expired. Start over." }, { status: 401 });

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`totp-verify:${pending.userId}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const code = typeof json?.token === "string" ? json.token.trim() : "";
  if (!code) return NextResponse.json({ error: "A code is required." }, { status: 400 });

  const [cred] = await db.select().from(totpCredential).where(eq(totpCredential.userId, pending.userId)).limit(1);
  let ok = false;
  if (cred?.confirmedAt) {
    ok = verifyTotp(decryptSecret(cred.secretEncrypted), code);
  }

  if (!ok) {
    // Fall back to a one-time recovery code.
    const codeHash = hashToken(code);
    const rows = await db
      .select()
      .from(recoveryCode)
      .where(
        and(eq(recoveryCode.userId, pending.userId), eq(recoveryCode.codeHash, codeHash), isNull(recoveryCode.usedAt)),
      )
      .limit(1);
    if (rows[0]) {
      await db.update(recoveryCode).set({ usedAt: new Date() }).where(eq(recoveryCode.id, rows[0].id));
      ok = true;
    }
  }

  if (!ok) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  const [owner] = await db.select().from(userTable).where(eq(userTable.id, pending.userId)).limit(1);
  if (!owner || !owner.active) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const userAgent = req.headers.get("user-agent");
  const { raw, expiresAt } = await createSession(owner.id, { ip, userAgent });
  await db.update(userTable).set({ lastLoginAt: new Date() }).where(eq(userTable.id, owner.id));
  await recordAudit({
    actorUserId: owner.id,
    actorRole: owner.role,
    actorType: "owner",
    action: "auth.totp_verified_session_created",
    entityType: "user",
    entityId: owner.id,
    ip,
    userAgent,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  response.cookies.delete(MFA_PENDING_COOKIE);
  return response;
}
