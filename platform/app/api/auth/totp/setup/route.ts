import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db/client";
import { totpCredential } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { generateTotpSecret, totpProvisioningUri, verifyTotp } from "@/lib/auth/totp";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Requires an already-authenticated owner session (issued either by a
 * first-ever magic-link login with no TOTP yet, or an existing owner
 * re-enrolling). Generates a new secret and stores it unconfirmed —
 * confirmedAt is only set by /api/auth/totp/confirm after the owner proves
 * they can produce a valid code, so a half-finished setup never becomes a
 * usable second factor.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const existing = await db.select().from(totpCredential).where(eq(totpCredential.userId, user.id)).limit(1);

  // Re-enrolling over a CONFIRMED credential requires a code from the
  // current authenticator. Previously, merely loading /admin/totp-setup
  // reset confirmedAt to null, so anyone holding a session cookie (or an
  // owner who opened the page and walked away) silently turned 2FA off.
  if (existing[0]?.confirmedAt) {
    const json = await req.json().catch(() => null);
    const currentCode = typeof json?.currentCode === "string" ? json.currentCode.trim() : "";
    if (!currentCode) {
      return NextResponse.json(
        { error: "current_code_required", message: "Enter a code from your current authenticator to replace it." },
        { status: 409 },
      );
    }
    if (!verifyTotp(decryptSecret(existing[0].secretEncrypted), currentCode)) {
      return NextResponse.json({ error: "Incorrect code from your current authenticator." }, { status: 400 });
    }
  }

  const secret = generateTotpSecret();
  const secretEncrypted = encryptSecret(secret);
  if (existing.length > 0) {
    await db
      .update(totpCredential)
      .set({ secretEncrypted, confirmedAt: null })
      .where(eq(totpCredential.userId, user.id));
  } else {
    await db.insert(totpCredential).values({ userId: user.id, secretEncrypted });
  }

  const uri = totpProvisioningUri(user.email, secret);
  const qrDataUrl = await QRCode.toDataURL(uri);

  return NextResponse.json({ secret, provisioningUri: uri, qrDataUrl });
}
