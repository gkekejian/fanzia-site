import { createHmac, timingSafeEqual } from "crypto";

export const MFA_PENDING_COOKIE = "fz_mfa_pending";
const TTL_MS = 5 * 60 * 1000; // 5 minutes to enter the TOTP code

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required (see .env.example)");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/**
 * A returning owner who already has a confirmed TOTP credential does not
 * get a full session immediately after clicking the magic link — they get
 * this short-lived, HMAC-signed, second-factor-pending token instead
 * (never a DB row; it's stateless so no cleanup job is needed for it).
 * Only after the correct TOTP code is presented does lib/auth/session.ts
 * issue the real session cookie. A brand-new owner with no TOTP set up yet
 * skips this step entirely (see app/api/auth/magic-link/verify/route.ts).
 */
export function createMfaPendingToken(userId: string): string {
  const payload = `${userId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyMfaPendingToken(token: string | undefined): { userId: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts;
  const payload = `${userId}.${expiresAtRaw}`;
  const expected = sign(payload);

  const a = Buffer.from(signature!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  return { userId: userId! };
}
