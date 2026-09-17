import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { totpCredential, recoveryCode } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyTotp, generateRecoveryCodes } from "@/lib/auth/totp";
import { decryptSecret, hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

/**
 * Confirms a just-created (unconfirmed) TOTP secret with a real 6-digit
 * code, then issues one-time recovery codes — shown exactly once here,
 * stored only as hashes from then on, same pattern as API keys.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const code = typeof json?.token === "string" ? json.token.trim() : "";
  if (!code) return NextResponse.json({ error: "A 6-digit code is required." }, { status: 400 });

  const [cred] = await db.select().from(totpCredential).where(eq(totpCredential.userId, user.id)).limit(1);
  if (!cred) return NextResponse.json({ error: "No TOTP setup in progress. Call setup first." }, { status: 400 });

  const secret = decryptSecret(cred.secretEncrypted);
  if (!verifyTotp(secret, code)) {
    return NextResponse.json({ error: "Incorrect code. Try again." }, { status: 400 });
  }

  await db.update(totpCredential).set({ confirmedAt: new Date() }).where(eq(totpCredential.userId, user.id));

  const rawCodes = generateRecoveryCodes(10);
  await db.delete(recoveryCode).where(eq(recoveryCode.userId, user.id));
  await db.insert(recoveryCode).values(rawCodes.map((raw) => ({ userId: user.id, codeHash: hashToken(raw) })));

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    actorType: "owner",
    action: "auth.totp_confirmed",
    entityType: "user",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true, recoveryCodes: rawCodes });
}
