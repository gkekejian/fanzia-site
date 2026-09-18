/**
 * Human-readable messages for the `?error=` params the magic-link verify
 * routes redirect with. Client-safe (no server imports) — used by the
 * admin and buyer login pages so an expired/used link explains itself
 * instead of silently rendering a blank form.
 */
export const LINK_ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That sign-in link was incomplete. Request a fresh one below.",
  invalid_or_expired:
    "That sign-in link is invalid or has expired. Links last 15 minutes and can only be used once — request a fresh one below.",
};

export function linkErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return LINK_ERROR_MESSAGES[code] ?? "That sign-in link didn't work. Request a fresh one below.";
}
