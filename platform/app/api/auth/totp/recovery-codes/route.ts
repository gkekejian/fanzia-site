import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { totpCredential, recoveryCode } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyTotp, generateRecoveryCodes } from "@/lib/auth/totp";
import { decryptSecret, hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Self-service recovery-code management for the signed-in owner.
 *
 * GET  -> { totpEnabled, unusedRecoveryCodes } so the Security page can
 *         show status without ever revealing code values.
 * POST -> regenerates the 10 recovery codes. Requires a current valid
 *         TOTP code as proof of authenticator possession (the codes are
 *         the fallback for a LOST authenticator, so losing the codes
 *         alone must not lock anyone out — but minting new ones must
 *         still prove identity). Old codes are invalidated immediately,
 *         new codes are returned exactly once and stored as hashes.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [cred] = await db.select().from(totpCredential).where(eq(totpCredential.userId, user.id)).limit(1);
  let unused = 0;
  if (cred?.confirmedAt) {
    const rows = await db
      .select({ id: recoveryCode.id })
      .from(recoveryCode)
      .where(and(eq(recoveryCode.userId, user.id), isNull(recoveryCode.usedAt)));
    unused = rows.length;
  }
  return NextResponse.json({ totpEnabled: !!cred?.confirmedAt, unusedRecoveryCodes: unused });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`totp-recovery-regen:${user.id}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const code = typeof json?.token === "string" ? json.token.trim() : "";
  if (!code) return NextResponse.json({ error: "A 6-digit code is required." }, { status: 400 });

  const [cred] = await db.select().from(totpCredential).where(eq(totpCredential.userId, user.id)).limit(1);
  if (!cred?.confirmedAt || !verifyTotp(decryptSecret(cred.secretEncrypted), code)) {
    return NextResponse.json({ error: "Incorrect code. Try again." }, { status: 400 });
  }

  const rawCodes = generateRecoveryCodes(10);
  await db.delete(recoveryCode).where(eq(recoveryCode.userId, user.id));
  await db.insert(recoveryCode).values(rawCodes.map((raw) => ({ userId: user.id, codeHash: hashToken(raw) })));

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    actorType: "owner",
    action: "auth.recovery_codes_regenerated",
    entityType: "user",
    entityId: user.id,
    ip,
  });

  return NextResponse.json({ ok: true, recoveryCodes: rawCodes });
}
