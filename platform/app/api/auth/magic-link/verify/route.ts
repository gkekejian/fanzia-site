import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable, totpCredential } from "@/db/schema";
import { consumeMagicLink } from "@/lib/auth/magicLink";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { createMfaPendingToken, MFA_PENDING_COOKIE } from "@/lib/auth/mfaPending";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";

function redirectTo(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url));
}

/**
 * A returning owner who already confirmed TOTP does not get a full session
 * from the magic link alone — they land on /admin/login/totp with only a
 * short-lived MFA-pending cookie until the code is verified. A brand-new
 * owner with no TOTP credential yet gets a full session directly (the
 * magic link itself, sent to a known address, is the first factor) and is
 * sent to /admin/totp-setup to finish enrolling before using anything else.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirectTo(req, "/admin/login?error=missing_token");

  const result = await consumeMagicLink(token);
  if (!result) return redirectTo(req, "/admin/login?error=invalid_or_expired");

  const [owner] = await db.select().from(userTable).where(eq(userTable.id, result.userId)).limit(1);
  if (!owner || !owner.active) return redirectTo(req, "/admin/login?error=invalid_or_expired");

  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");

  const [totp] = await db.select().from(totpCredential).where(eq(totpCredential.userId, owner.id)).limit(1);

  if (totp?.confirmedAt) {
    const response = redirectTo(req, "/admin/login/totp");
    response.cookies.set(MFA_PENDING_COOKIE, createMfaPendingToken(owner.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 5 * 60,
    });
    await recordAudit({
      actorUserId: owner.id,
      actorRole: owner.role,
      actorType: "owner",
      action: "auth.magic_link_verified_awaiting_totp",
      entityType: "user",
      entityId: owner.id,
      ip,
      userAgent,
    });
    return response;
  }

  const { raw, expiresAt } = await createSession(owner.id, { ip, userAgent });
  await db.update(userTable).set({ lastLoginAt: new Date() }).where(eq(userTable.id, owner.id));
  await recordAudit({
    actorUserId: owner.id,
    actorRole: owner.role,
    actorType: "owner",
    action: "auth.magic_link_verified_no_totp_yet",
    entityType: "user",
    entityId: owner.id,
    ip,
    userAgent,
  });

  const response = redirectTo(req, "/admin/totp-setup");
  response.cookies.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
