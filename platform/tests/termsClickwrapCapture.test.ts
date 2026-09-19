import { describe, it, expect } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { application as applicationTable, applicationDocument, termsVersion, termsAcceptance, user as userTable } from "@/db/schema";
import { decideApplication } from "@/lib/applications/decide";
import { termsClickwrapLabel } from "@/lib/policies/clickwrap";
import { hashToken } from "@/lib/crypto";
import type { Actor } from "@/lib/auth/rbac";

// Build prompt §12 / test gate #20: clickwrap evidence captures exact
// visible language, version, timestamp, IP, user agent, and page context,
// and survives the applicant-time -> account-time transition (accountId
// doesn't exist yet when the applicant checks the box).
describe("terms clickwrap capture", () => {
  it("captures full evidence at application time and backfills accountId on approval", async () => {
    const { db } = await createTestDb();

    const [published] = await db
      .insert(termsVersion)
      .values({
        docType: "terms_of_sale",
        versionLabel: "draft-v1",
        bodyMarkdown: "terms text",
        isDraft: false,
        publishedAt: new Date(),
      })
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

    // Simulates exactly what app/api/applications/route.ts does at submit time.
    await db.insert(termsAcceptance).values({
      applicationId: app!.id,
      termsVersionId: published!.id,
      visibleLanguageSnapshot: termsClickwrapLabel(published!.versionLabel),
      ip: "203.0.113.5",
      userAgent: "vitest-agent/1.0",
      pageContext: "/apply",
    });

    const [acceptedAtApplyTime] = await db
      .select()
      .from(termsAcceptance)
      .where(eq(termsAcceptance.applicationId, app!.id));
    expect(acceptedAtApplyTime!.accountId).toBeNull();
    expect(acceptedAtApplyTime!.visibleLanguageSnapshot).toBe(
      "I have read and agree to Fanzia's Terms of Sale (version draft-v1).",
    );
    expect(acceptedAtApplyTime!.ip).toBe("203.0.113.5");
    expect(acceptedAtApplyTime!.userAgent).toBe("vitest-agent/1.0");
    expect(acceptedAtApplyTime!.pageContext).toBe("/apply");

    const [owner] = await db
      .insert(userTable)
      .values({ email: "owner@fanzia.io", name: "Owner", role: "owner" })
      .returning();
    const ownerActor: Actor = { kind: "owner", user: { id: owner!.id, email: owner!.email, name: owner!.name, role: "owner" } };

    // Owner policy (2026-09-19): approval needs a seller's permit copy on file.
    await db.insert(applicationDocument).values({
      applicationId: app!.id,
      docType: "sellers_permit",
      storageKey: "fake-permit-key",
      originalFilename: "permit.pdf",
      mimeVerified: "application/pdf",
      sizeBytes: 100,
    });

    const outcome = await decideApplication({ applicationId: app!.id, decision: "approved", actor: ownerActor }, db);
    if (!outcome.executed) throw new Error("expected direct execution");
    const accountId = (outcome.result as { accountId: string }).accountId;

    const [acceptedAfterApproval] = await db
      .select()
      .from(termsAcceptance)
      .where(eq(termsAcceptance.applicationId, app!.id));
    expect(acceptedAfterApproval!.accountId).toBe(accountId);
    // The original snapshot is untouched by the backfill.
    expect(acceptedAfterApproval!.visibleLanguageSnapshot).toBe(acceptedAtApplyTime!.visibleLanguageSnapshot);

    const stillUnlinked = await db.select().from(termsAcceptance).where(isNull(termsAcceptance.accountId));
    expect(stillUnlinked).toHaveLength(0);
  });
});
