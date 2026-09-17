import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { user as userTable, agentProposal, auditLog } from "@/db/schema";
import { performOrPropose, RESTRICTED_ACTIONS } from "@/lib/auth/rbac";
import type { Actor } from "@/lib/auth/rbac";

// Build prompt §14 / test gate #32: "An agent service-account key cannot
// execute any restricted action; it can only create an agent_proposal."
describe("performOrPropose", () => {
  async function seedUsers(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
    const [owner] = await db
      .insert(userTable)
      .values({ email: "owner@fanzia.io", name: "Owner", role: "owner" })
      .returning();
    const [agent] = await db
      .insert(userTable)
      .values({ email: "muse@fanzia.internal", name: "Muse", role: "ai_operator" })
      .returning();
    return { owner: owner!, agent: agent! };
  }

  it("an ai_operator actor never executes a restricted action directly", async () => {
    const { db } = await createTestDb();
    const { agent } = await seedUsers(db);

    let executed = false;
    const actor: Actor = {
      kind: "ai_operator",
      agent: { id: agent.id, email: agent.email, name: agent.name, role: "ai_operator", scopes: ["read"], apiKeyId: "test" },
    };

    const restrictedAction = [...RESTRICTED_ACTIONS][0]!;
    const outcome = await performOrPropose(
      actor,
      restrictedAction,
      { type: "application", id: "abc" },
      { rationale: "test" },
      async () => {
        executed = true;
        return "should not run";
      },
      db,
    );

    expect(executed).toBe(false);
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) {
      const proposals = await db.select().from(agentProposal).where(eq(agentProposal.id, outcome.proposalId));
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.decision).toBe("pending");
    }
  });

  it("an owner actor executes restricted actions directly", async () => {
    const { db } = await createTestDb();
    const { owner } = await seedUsers(db);

    let executed = false;
    const actor: Actor = { kind: "owner", user: { id: owner.id, email: owner.email, name: owner.name, role: "owner" } };
    const restrictedAction = [...RESTRICTED_ACTIONS][0]!;

    const outcome = await performOrPropose(
      actor,
      restrictedAction,
      { type: "application", id: "abc" },
      {},
      async () => {
        executed = true;
        return "ran";
      },
      db,
    );

    expect(executed).toBe(true);
    expect(outcome.executed).toBe(true);
  });

  it("an ai_operator actor executes non-restricted actions directly and is still audited", async () => {
    const { db } = await createTestDb();
    const { agent } = await seedUsers(db);

    let executed = false;
    const actor: Actor = {
      kind: "ai_operator",
      agent: { id: agent.id, email: agent.email, name: agent.name, role: "ai_operator", scopes: ["read"], apiKeyId: "test" },
    };

    const outcome = await performOrPropose(
      actor,
      "compliance_task.update",
      { type: "compliance_task", id: "1" },
      {},
      async () => {
        executed = true;
        return "ran";
      },
      db,
    );

    expect(executed).toBe(true);
    expect(outcome.executed).toBe(true);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "compliance_task.update"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorType).toBe("ai_operator");
  });
});
