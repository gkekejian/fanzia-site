import { redirect } from "next/navigation";
import { getCurrentUser, type AuthedUser } from "./session";

/**
 * Server-side guard for admin pages (not API routes — those use
 * lib/auth/actor.ts). ai_operator never holds a cookie session (build
 * prompt §14.1: API keys only), so any page protected by this guard is, by
 * construction, owner-only.
 *
 * Owners who have not confirmed TOTP are sent to /admin/totp-setup. Only
 * the setup page itself passes `allowUnenrolled`.
 */
export async function requireOwnerPageUser(opts: { allowUnenrolled?: boolean } = {}): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (user.mfaEnrolled !== true && !opts.allowUnenrolled) redirect("/admin/totp-setup");
  return user;
}
