import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { magicLink, user as userTable } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/crypto";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes — short-lived, single use

/**
 * Owner-only login path (build prompt §14.1: ai_operator authenticates by
 * API key, never email). Returns null silently for an unknown email so the
 * request handler can give an identical response either way and avoid
 * leaking which addresses are registered owners.
 */
export async function createMagicLink(email: string): Promise<{ raw: string; userId: string } | null> {
  const rows = await db
    .select()
    .from(userTable)
    .where(and(eq(userTable.email, email), eq(userTable.role, "owner"), eq(userTable.active, true)))
    .limit(1);
  const owner = rows[0];
  if (!owner) return null;

  const raw = generateToken();
  await db.insert(magicLink).values({
    userId: owner.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  });
  return { raw, userId: owner.id };
}

export async function consumeMagicLink(raw: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(raw);
  const rows = await db
    .select()
    .from(magicLink)
    .where(and(eq(magicLink.tokenHash, tokenHash), isNull(magicLink.usedAt), gt(magicLink.expiresAt, new Date())))
    .limit(1);
  const link = rows[0];
  if (!link) return null;

  await db.update(magicLink).set({ usedAt: new Date() }).where(eq(magicLink.id, link.id));
  return { userId: link.userId };
}
