import { randomBytes, createHash, createCipheriv, createDecipheriv } from "crypto";

/**
 * High-entropy random tokens (magic links, resume tokens, API keys). Raw
 * value is only ever transmitted once (in the email URL, or shown once in
 * the admin UI for API keys) — only the hash is persisted.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 is sufficient here because the input is always a high-entropy
 * random token, not a low-entropy user-chosen secret — there is nothing to
 * brute force offline once the hash is exfiltrated, since guessing the
 * 32-byte preimage is infeasible regardless of hash speed. (A slow KDF like
 * scrypt/argon2 would be required for user-chosen passwords, which this
 * platform doesn't have — auth is magic-link + TOTP + API key only.)
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getEncryptionKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Used only for TOTP secrets at rest. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** API keys are prefixed so they're identifiable (and greppable/revokable) without revealing the secret. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `fzk_${generateToken(24)}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashToken(raw) };
}
