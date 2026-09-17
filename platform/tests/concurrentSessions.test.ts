import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { user as userTable, apiKey as apiKeyTable, session as sessionTable } from "@/db/schema";
import { createSession, getSessionUser, revokeSession } from "@/lib/auth/session";
import { getAgentFromApiKey } from "@/lib/auth/apiKey";
import { generateApiKey } from "@/lib/crypto";

/**
 * Build prompt §14.1 / phase-plan.md Phase 1 test requirement: an owner
 * cookie session and the ai_operator API key must never lock each other
 * out — they resolve through entirely independent tables (session vs
 * api_key) and lookup functions (lib/auth/session.ts, lib/auth/apiKey.ts).
 */
describe("concurrent owner session + ai_operator API key", () => {
  it("both credential types resolve independently and simultaneously", async () => {
    const { db } = await createTestDb();

    const [owner] = await db
      .insert(userTable)
      .values({ email: "owner@fanzia.io", name: "Owner", role: "owner" })
      .returning();
    const [agent] = await db
      .insert(userTable)
      .values({ email: "muse@fanzia.internal", name: "Muse", role: "ai_operator" })
      .returning();

    const { raw: rawSession } = await createSession(owner!.id, { ip: "1.1.1.1", userAgent: "test" }, db);

    const { raw: rawApiKey, prefix, hash } = generateApiKey();
    await db.insert(apiKeyTable).values({
      userId: agent!.id,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: ["read"],
      createdBy: agent!.id,
    });

    // Resolve both concurrently, repeatedly — neither should ever observe
    // or be blocked by the other's credential.
    for (let i = 0; i < 5; i++) {
      const [sessionUser, agentUser] = await Promise.all([
        getSessionUser(rawSession, db),
        getAgentFromApiKey(rawApiKey, db),
      ]);
      expect(sessionUser).not.toBeNull();
      expect(sessionUser!.role).toBe("owner");
      expect(agentUser).not.toBeNull();
      expect(agentUser!.role).toBe("ai_operator");
    }

    // Revoking the owner session must not touch the api_key row or resolution.
    await revokeSession(rawSession, db);
    const sessionAfterRevoke = await getSessionUser(rawSession, db);
    const agentAfterOwnerRevoke = await getAgentFromApiKey(rawApiKey, db);
    expect(sessionAfterRevoke).toBeNull();
    expect(agentAfterOwnerRevoke).not.toBeNull();

    // And the reverse: revoking the api key must not touch the session table.
    const { raw: rawSession2 } = await createSession(owner!.id, { ip: null, userAgent: null }, db);
    await db.update(apiKeyTable).set({ revokedAt: new Date() }).where(eq(apiKeyTable.keyHash, hash));
    const agentAfterKeyRevoke = await getAgentFromApiKey(rawApiKey, db);
    const sessionAfterKeyRevoke = await getSessionUser(rawSession2, db);
    expect(agentAfterKeyRevoke).toBeNull();
    expect(sessionAfterKeyRevoke).not.toBeNull();

    // Both a live owner session row and a (now-revoked) api_key row for the
    // agent coexist in session/api_key tables without cross-contamination.
    const sessionRows = await db.select().from(sessionTable).where(eq(sessionTable.userId, owner!.id));
    const keyRows = await db.select().from(apiKeyTable).where(eq(apiKeyTable.userId, agent!.id));
    expect(sessionRows.length).toBeGreaterThan(0);
    expect(keyRows).toHaveLength(1);
  });
});
