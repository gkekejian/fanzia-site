import * as OTPAuth from "otpauth";
import { randomBytes } from "crypto";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpProvisioningUri(email: string, base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "Fanzia Wholesale Platform",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  return totp.toString();
}

export function verifyTotp(base32Secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  // window: 1 tolerates ±30s clock drift, standard practice for TOTP.
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}
