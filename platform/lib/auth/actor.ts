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

/** Convenience wrapper: returns the resolved Actor, or a ready-to-return 401 response. */
export async function requireActor(req: NextRequest): Promise<Actor | NextResponse> {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return actor;
}
