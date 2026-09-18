import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { user as userTable, application as applicationTable } from "@/db/schema";
import { decideApplication, AlreadyDecidedError } from "@/lib/applications/decide";
import {
  DECISION_REASONS,
  composeDecisionReason,
  isValidReasonCode,
} from "@/lib/applications/decisionReasons";
import type { Actor } from "@/lib/auth/rbac";
import { hashToken } from "@/lib/crypto";

describe("decisionReasons", () => {
  it("every decision has a non-empty reason list ending in Other", () => {
    for (const decision of ["approved", "declined", "needs_review"] as const) {
      const reasons = DECISION_REASONS[decision];
      expect(reasons.length).toBeGreaterThan(1);
      expect(reasons[reasons.length - 1]!.code).toBe("other");
      const codes = reasons.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length); // no duplicates
    }
  });

  it("composes label-only when no note is given", () => {
    expect(composeDecisionReason("declined", "missing_documents")).toBe(
      "Required documents missing or unreadable",
    );
  });

  it("appends a note to the label", () => {
    expect(composeDecisionReason("approved", "meets_criteria", "  Strong references  ")).toBe(
      "Meets all wholesale criteria — Strong references",
    );
  });

  it("other requires a note and stores just the note", () => {
    expect(composeDecisionReason("declined", "other", "Suspected fraud")).toBe("Suspected fraud");
    expect(() => composeDecisionReason("declined", "other", "   ")).toThrow(/note is required/i);
  });

  it("rejects unknown codes and overlong notes", () => {
    expect(() => composeDecisionReason("approved", "missing_documents")).toThrow(/unknown reason code/i);
    expect(isValidReasonCode("approved", "missing_documents")).toBe(false);
    expect(isValidReasonCode("declined", "missing_documents")).toBe(true);
    expect(() => composeDecisionReason("declined", "missing_documents", "x".repeat(501))).toThrow(
      /500 characters or fewer/,
    );
  });
});

describe("decideApplication terminal-state guard", () => {
  async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"], status: "submitted" | "approved" | "declined") {
    const [owner] = await db
      .insert(userTable)
      .values({ email: "owner@fanzia.io", name: "Owner", role: "owner" })
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
        status,
      })
      .returning();
    const ownerActor: Actor = {
      kind: "owner",
      user: { id: owner!.id, email: owner!.email, name: owner!.name, role: "owner" },
    };
    return { app: app!, ownerActor };
  }

  it("refuses to re-decide an approved application (no duplicate account or email)", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db, "approved");

    await expect(
      decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db),
    ).rejects.toBeInstanceOf(AlreadyDecidedError);
    await expect(
      decideApplication({ applicationId: app.id, decision: "declined", actor: ownerActor }, db),
    ).rejects.toBeInstanceOf(AlreadyDecidedError);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("approved");
  });

  it("refuses to re-decide a declined application", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db, "declined");

    await expect(
      decideApplication({ applicationId: app.id, decision: "approved", actor: ownerActor }, db),
    ).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it("still allows submitted -> needs_review -> approved", async () => {
    const { db } = await createTestDb();
    const { app, ownerActor } = await seed(db, "submitted");

    const r1 = await decideApplication(
      { applicationId: app.id, decision: "needs_review", reason: "Documents need closer review", actor: ownerActor },
      db,
    );
    expect(r1.executed).toBe(true);

    const r2 = await decideApplication(
      { applicationId: app.id, decision: "approved", reason: "Meets all wholesale criteria", actor: ownerActor },
      db,
    );
    expect(r2.executed).toBe(true);

    const [reloaded] = await db.select().from(applicationTable).where(eq(applicationTable.id, app.id));
    expect(reloaded!.status).toBe("approved");
    expect(reloaded!.decisionReason).toBe("Meets all wholesale criteria");
    expect(reloaded!.accountId).not.toBeNull();
  });
});
