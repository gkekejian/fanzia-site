import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  user as userTable,
  application as applicationTable,
  account as accountTable,
  agentProposal,
  applicationDocument,
} from "@/db/schema";
import { decideApplication } from "@/lib/applications/decide";
import { determineTax, ValidationError } from "@/lib/applications/taxDetermine";
import { executeApprovedProposal } from "@/lib/auth/proposalExecution";
import type { Actor } from "@/lib/auth/rbac";
import { hashToken } from "@/lib/crypto";

/**
 * Build prompt test gate #32 / phase-plan.md: "attempting any mutating
 * action outside an approved human UI path or the proposal queue is
 * rejected at the API layer" — exercised here against every mutating
 * admin endpoint that exists in Phase 1: application decision
 * (approve/decline/needs_review) and tax determination. Both service
 * functions are the exact code the HTTP routes call
 * (app/api/admin/applications/[id]/decision, .../tax-determination), so
 * this is real endpoint-logic coverage, not a re-test of performOrPropose
 * in the abstract (already covered by tests/rbacAgentProposal.test.ts).
 */
describe("agent_proposal enforcement across every Phase 1 mutating endpoint", () => {
  async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
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
        businessLegalName: "Test Co",
        channelType: "vending",
        addressLine1: "1 Main St",
        city: "Glendale",
        state: "CA",
        postalCode: "91201",
        contactName: "Jane Doe",
        contactEmail: "jane@example.com",
        resumeTokenHash: hashToken("resume-token"),
        resumeTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
        status: "submitted",
      })
      .returning();

    const ownerActor: Actor = { kind: "owner", user: { id: owner!.id, email: owner!.email, name: owner!.name, role: "owner" } };
    const agentActor: Actor = {
      kind: "ai_operator",
      agent: { id: agentUser!.id, email: agentUser!.email, name: agentUser!.name, role: "ai_operator", scopes: ["read"], apiKeyId: "test" },
    };
    // Owner policy (2026-09-19): approval requires a seller's permit copy on
    // file, so the shared seed includes one — the gate itself is covered in
    // tests/applicationApprovalPermitGate.test.ts.
    await db.insert(applicationDocument).values({
      applicationId: app!.id,
      docType: "sellers_permit",
      storageKey: "fake-permit-key",
      originalFilename: "permit.pdf",
      mimeVerified: "application/pdf",
      sizeBytes: 100,
    });
    return { owner: owner!, agentUser: agentUser!, app: app!, ownerActor, agentActor };
  }

  it("application.approve: ai_operator gets a proposal, never executes directly", async () => {
    const { db } = await createTestDb();
    const { app, agentActor } = await seed(db);

    const outcome = await decideApplication({ applicationId: app.id, decision: "approved", actor: agentActor }, db);
    expect(outcome.executed).toBe(false);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("submitted"); // unchanged
    expect(reloaded!.accountId).toBeNull(); // no account created

    if (!outcome.executed) {
      const [proposal] = await db.select().from(agentProposal).where(eq(agentProposal.id, outcome.proposalId));
      expect(proposal!.proposedAction).toBe("application.approve");
      expect(proposal!.decision).toBe("pending");
    }
  });

  it("application.decline: ai_operator gets a proposal, never executes directly", async () => {
    const { db } = await createTestDb();
    const { app, agentActor } = await seed(db);

    const outcome = await decideApplication({ applicationId: app.id, decision: "declined", actor: agentActor }, db);
    expect(outcome.executed).toBe(false);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("submitted");
  });

  it("application.needs_review: not restricted — ai_operator executes it directly", async () => {
    const { db } = await createTestDb();
    const { app, agentActor } = await seed(db);

    const outcome = await decideApplication(
      { applicationId: app.id, decision: "needs_review", reason: "missing permit", actor: agentActor },
      db,
    );
    expect(outcome.executed).toBe(true);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("needs_review");
  });

  it("application.approve: owner executes directly and creates the account", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db);

    const outcome = await decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db);
    expect(outcome.executed).toBe(true);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("approved");
    expect(reloaded!.accountId).not.toBeNull();

    const [acct] = await db.select().from(accountTable).where(eq(accountTable.id, reloaded!.accountId!));
    // Approval must never grant tax exemption: two independent fields, two
    // independent actions (build prompt §8, test gate #4).
    expect(acct!.taxStatus).toBe("pending");
  });

  it("application.tax_determine: requires evidence for 'exempt' regardless of actor", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db);
    const approveOutcome = await decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db);
    if (!approveOutcome.executed) throw new Error("expected direct execution");
    const accountId = (approveOutcome.result as { accountId: string }).accountId;

    await expect(
      determineTax({ accountId, status: "exempt", evidenceObjectKey: null, notes: "no evidence attached", actor: ownerActor }, db),
    ).rejects.toThrow(ValidationError);
  });

  it("application.tax_determine: ai_operator gets a proposal even with valid evidence, never sets tax_status directly", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor, agentActor } = await seed(db);
    const approveOutcome = await decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db);
    if (!approveOutcome.executed) throw new Error("expected direct execution");
    const accountId = (approveOutcome.result as { accountId: string }).accountId;

    const [doc] = await db
      .insert(applicationDocument)
      .values({
        applicationId: app.id,
        docType: "resale_certificate_cdtfa230",
        storageKey: "fake-key",
        originalFilename: "cert.pdf",
        mimeVerified: "application/pdf",
        sizeBytes: 100,
      })
      .returning();

    const outcome = await determineTax(
      { accountId, status: "exempt", evidenceObjectKey: doc!.storageKey, notes: "cert on file", actor: agentActor },
      db,
    );
    expect(outcome.executed).toBe(false);

    const [acct] = await db.select().from(accountTable).where(eq(accountTable.id, accountId));
    expect(acct!.taxStatus).toBe("pending"); // untouched by the proposal alone

    if (!outcome.executed) {
      const [proposal] = await db.select().from(agentProposal).where(eq(agentProposal.id, outcome.proposalId));
      expect(proposal!.proposedAction).toBe("application.tax_determine");

      // Approving the proposal re-runs the exact same logic as the owner
      // and this time it actually executes.
      const [ownerRow] = await db.select().from(userTable).where(eq(userTable.role, "owner"));
      await executeApprovedProposal(
        { proposedAction: proposal!.proposedAction, payload: proposal!.payload as Record<string, unknown> },
        { id: ownerRow!.id, email: ownerRow!.email, name: ownerRow!.name, role: "owner" },
        db,
      );
      const [acctAfter] = await db.select().from(accountTable).where(eq(accountTable.id, accountId));
      expect(acctAfter!.taxStatus).toBe("exempt");
    }
  });
});
