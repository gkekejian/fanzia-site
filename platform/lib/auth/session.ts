import { cookies } from "next/headers";
import { eq, isNull, gt, and } from "drizzle-orm";
import { db } from "@/db/client";
import { session as sessionTable, user as userTable } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/crypto";

export const SESSION_COOKIE = "fz_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "ai_operator";
};

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const raw = generateToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionTable).values({
    userId,
    tokenHash,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    expiresAt,
  });
  return { raw, expiresAt };
}

/**
 * Owner and ai_operator sessions are independent by construction: each
 * lives in its own row keyed by its own user_id, and nothing in this
 * lookup path treats one identity's session as exclusive of another's, so
 * concurrent owner + ai_operator sessions never contend (build prompt
 * §14.1: "the AI operator session never locks out, and is never locked
 * out by, an owner session").
 */
export async function getSessionUser(rawToken: string | undefined): Promise<AuthedUser | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select({ user: userTable, expiresAt: sessionTable.expiresAt })
    .from(sessionTable)
    .innerJoin(userTable, eq(sessionTable.userId, userTable.id))
    .where(
      and(
        eq(sessionTable.tokenHash, tokenHash),
        isNull(sessionTable.revokedAt),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.user.active) return null;
  return { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role };
}

export async function getCurrentUser(): Promise<AuthedUser | null> {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  return getSessionUser(raw);
}

export async function revokeSession(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  await db.update(sessionTable).set({ revokedAt: new Date() }).where(eq(sessionTable.tokenHash, tokenHash));
}
