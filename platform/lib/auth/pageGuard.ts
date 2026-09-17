import { redirect } from "next/navigation";
import { getCurrentUser, type AuthedUser } from "./session";

/**
 * Server-side guard for admin pages (not API routes — those use
 * lib/auth/actor.ts). ai_operator never holds a cookie session (build
 * prompt §14.1: API keys only), so any page protected by this guard is, by
 * construction, owner-only — there's no separate ai_operator page surface
 * to gate in Phase 1.
 */
export async function requireOwnerPageUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  return user;
}
