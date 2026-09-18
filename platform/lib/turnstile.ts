/**
 * Cloudflare Turnstile bot protection (free tier).
 *
 * Server-side verification: every public write endpoint that renders a
 * Turnstile widget must call verifyTurnstile() with the token the client
 * submits, and reject the request (403) when verification fails.
 *
 * Fail-open design: if TURNSTILE_SECRET_KEY is unset (local dev, staging
 * before the keys are provisioned), verification is skipped with a warning
 * and the submission is ALLOWED. Deploys must never break for a missing
 * key; the owner arms protection by setting both keys in Cloudflare
 * Dashboard → Turnstile and adding them to the environment.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  ok: boolean;
  /** Present when verification ran and Cloudflare rejected the token. */
  errorCodes?: string[];
  /** True when verification was skipped because no secret key is configured. */
  skipped?: boolean;
}

/**
 * Verify a Turnstile client token against Cloudflare's siteverify endpoint.
 * Returns ok:false when the token is missing, invalid, or the network call
 * fails. Returns ok:true with skipped:true when TURNSTILE_SECRET_KEY is
 * unset (fail-open — see module docstring).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[turnstile] TURNSTILE_SECRET_KEY is not set — skipping bot verification (fail-open).");
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== "string" || token.length > 2048) {
    return { ok: false };
  }
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; "error-codes"?: string[] } | null;
    if (data?.success === true) return { ok: true };
    return { ok: false, errorCodes: data?.["error-codes"] };
  } catch (err) {
    console.error("[turnstile] siteverify request failed:", err);
    return { ok: false };
  }
}

/** The 403 payload used when bot verification fails. */
export function turnstileFailureBody() {
  return { error: "Bot verification failed. Please complete the check and try again." };
}
