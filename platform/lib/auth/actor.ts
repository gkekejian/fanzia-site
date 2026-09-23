import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, SESSION_COOKIE } from "./session";
import { getAgentFromApiKey } from "./apiKey";
import type { Actor } from "./rbac";

/**
 * Every admin API route resolves its caller through here. An owner cookie
 * session and an ai_operator API key are checked independently and never
 * interfere with each other (see lib/auth/session.ts) — both credential
 * types can be "logged in" at the same time without either locking the
 * other out.
 */
export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    const agent = await getAgentFromApiKey(rawKey);
    if (!agent) return null;
    return { kind: "ai_operator", agent };
  }

  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(raw);
  if (!user) return null;
  return { kind: "owner", user };
}

/**
 * Convenience wrapper: returns the resolved Actor, or a ready-to-return
 * 401/403 response. An owner session without a confirmed TOTP credential
 * is refused here (403 mfa_enrollment_required): the only routes that
 * accept it are the enrollment endpoints under /api/auth/totp, which read
 * the session directly and never call requireActor.
 */
export async function requireActor(req: NextRequest): Promise<Actor | NextResponse> {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (actor.kind === "owner" && actor.user.mfaEnrolled !== true) {
    return NextResponse.json(
      { error: "mfa_enrollment_required", message: "Set up two-factor authentication at /admin/totp-setup first." },
      { status: 403 },
    );
  }
  return actor;
}
