import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKey as apiKeyTable, user as userTable } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import type { AuthedUser } from "./session";

export type AuthedAgent = AuthedUser & { scopes: string[]; apiKeyId: string };

/**
 * Resolves the `Authorization: Bearer <key>` header used exclusively by
 * the ai_operator identity (build prompt §14.1: "API keys are the AI's
 * credential type"). Revoked or inactive keys/users resolve to null, same
 * as an expired session — callers must treat "not authenticated" and
 * "authenticated but forbidden" identically until an explicit scope check.
 */
export async function getAgentFromApiKey(rawKey: string | undefined): Promise<AuthedAgent | null> {
  if (!rawKey) return null;
  const keyHash = hashToken(rawKey);
  const rows = await db
    .select({ key: apiKeyTable, user: userTable })
    .from(apiKeyTable)
    .innerJoin(userTable, eq(apiKeyTable.userId, userTable.id))
    .where(and(eq(apiKeyTable.keyHash, keyHash), isNull(apiKeyTable.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.user.active || row.user.role !== "ai_operator") return null;

  await db
    .update(apiKeyTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeyTable.id, row.key.id));

  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    role: row.user.role,
    scopes: row.key.scopes,
    apiKeyId: row.key.id,
  };
}
