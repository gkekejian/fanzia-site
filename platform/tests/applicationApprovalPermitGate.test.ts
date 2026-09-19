import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  user as userTable,
  application as applicationTable,
  account as accountTable,
  applicationDocument,
} from "@/db/schema";
import { decideApplication, MissingSellersPermitError } from "@/lib/applications/decide";
import type { Actor } from "@/lib/auth/rbac";
import { hashToken } from "@/lib/crypto";

/**
 * Owner policy (2026-09-19): a seller's permit copy must be on file before
 * a wholesale application can be approved. Applying is never blocked —
 * the applicant uploads via the status-link continue page — but approval
 * (and the buyer account it creates) waits for the document.
 */
describe("application approval requires a seller's permit on file", () => {
  async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"], docs: string[] = []) {
    const [owner] = await db
      .insert(userTable)
      .values({ email: "owner@fanzia.io", name: "Owner", role: "owner" })
      .returning();
    const [agentUser] = await db
      .insert(userTable)
      .values({ email: "muse@fanzia.internal", name: "Muse", role: "ai_operator" })
      .returning();
    const [app] = await db
      .insert(applicationTable)
      .values({
        businessLegalName: "Permitless Co",
        channelType: "other",
        addressLine1: "1401 N Batavia St",
        city: "Orange",
        state: "CA",
        postalCode: "92867",
        contactName: "Kevin Sorto",
        contactEmail: "kjassyshop@gmail.com",
        resumeTokenHash: hashToken("resume-token"),
        resumeTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
        status: "submitted",
      })
      .returning();
    for (const docType of docs) {
      await db.insert(applicationDocument).values({
        applicationId: app!.id,
        docType: docType as "sellers_permit",
        storageKey: `fake-key-${docType}`,
        originalFilename: `${docType}.pdf`,
        mimeVerified: "application/pdf",
        sizeBytes: 100,
      });
    }
    const ownerActor: Actor = { kind: "owner", user: { id: owner!.id, email: owner!.email, name: owner!.name, role: "owner" } };
    const agentActor: Actor = {
      kind: "ai_operator",
      agent: { id: agentUser!.id, email: agentUser!.email, name: agentUser!.name, role: "ai_operator", scopes: ["read"], apiKeyId: "test" },
    };
    return { app: app!, ownerActor, agentActor };
  }

  async function statusOf(db: Awaited<ReturnType<typeof createTestDb>>["db"], id: string) {
    const [row] = await db.select().from(applicationTable).where(eq(applicationTable.id, id));
    return row!;
  }

  it("owner approval without any documents is rejected and creates no account", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db);
    await expect(
      decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db),
    ).rejects.toThrow(MissingSellersPermitError);
    const reloaded = await statusOf(db, app.id);
    expect(reloaded.status).toBe("submitted");
    expect(reloaded.accountId).toBeNull();
    expect(await db.select().from(accountTable)).toHaveLength(0);
  });

  it("owner approval with only a non-permit document is rejected", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db, ["channel_evidence"]);
    await expect(
      decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db),
    ).rejects.toThrow(MissingSellersPermitError);
    expect((await statusOf(db, app.id)).status).toBe("submitted");
  });

  it("owner approval with a seller's permit on file succeeds", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db, ["sellers_permit"]);
    const outcome = await decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db);
    expect(outcome.executed).toBe(true);
    const reloaded = await statusOf(db, app.id);
    expect(reloaded.status).toBe("approved");
    expect(reloaded.accountId).not.toBeNull();
  });

  it("ai_operator approval without a permit fails fast instead of queueing a doomed proposal", async () => {
    const { db } = await createTestDb();
    const { app, agentActor } = await seed(db);
    await expect(
      decideApplication({ applicationId: app.id, decision: "approved", actor: agentActor }, db),
    ).rejects.toThrow(MissingSellersPermitError);
    expect((await statusOf(db, app.id)).status).toBe("submitted");
  });

  it("decline and needs_review are not gated by the permit requirement", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db);
    const declined = await decideApplication({ applicationId: app.id, decision: "declined", actor: ownerActor }, db);
    expect(declined.executed).toBe(true);
    expect((await statusOf(db, app.id)).status).toBe("declined");

    const { db: db2 } = await createTestDb();
    const seeded2 = await seed(db2);
    const flagged = await decideApplication(
      { applicationId: seeded2.app.id, decision: "needs_review", actor: seeded2.ownerActor },
      db2,
    );
    expect(flagged.executed).toBe(true);
  });
});
