/**
 * Single source of truth for "can a new buyer apply right now?" lives in
 * the platform (owner toggle on /admin/applications). The marketing site
 * reads it instead of hardcoding "Start your application" links that
 * dead-end on a paused page.
 *
 * Cached for 5 minutes via ISR; fails closed (waitlist) if the platform
 * is unreachable, which is the safe direction for a no-bandwidth team.
 */
export const PORTAL_BASE = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://app.fanzia.io";

export async function getApplicationsOpen(): Promise<boolean> {
  try {
    const res = await fetch(`${PORTAL_BASE}/api/public/portal-status`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { applicationsOpen?: unknown };
    return body.applicationsOpen === true;
  } catch {
    return false;
  }
}

export type PortalStatus = { applicationsOpen: boolean; allocation: boolean };

/** Applications toggle plus selling mode (allocation offers vs. self-serve ordering). */
export async function getPortalStatus(): Promise<PortalStatus> {
  try {
    const res = await fetch(`${PORTAL_BASE}/api/public/portal-status`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { applicationsOpen: false, allocation: false };
    const body = (await res.json()) as { applicationsOpen?: unknown; sellingMode?: unknown };
    return { applicationsOpen: body.applicationsOpen === true, allocation: body.sellingMode === "allocation" };
  } catch {
    return { applicationsOpen: false, allocation: false };
  }
}
