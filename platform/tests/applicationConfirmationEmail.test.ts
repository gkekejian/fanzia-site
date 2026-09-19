import { describe, it, expect } from "vitest";
import { buildApplicationConfirmationEmail } from "@/lib/applications/confirmationEmail";

/**
 * Owner requirement (2026-09-19): asking the applicant for missing
 * documents and channel evidence must be automatic, never a manual
 * follow-up. The submission confirmation email carries the checklist.
 */
describe("application confirmation email", () => {
  const base = {
    businessLegalName: "K & Jassy Shop LLC",
    ttlHours: 168,
    resumeUrl: "https://app.fanzia.io/apply/continue?token=abc",
  };

  it("always requests the seller's permit copy and includes the status link", () => {
    const { subject, text } = buildApplicationConfirmationEmail({
      ...base,
      channelEvidenceUrl: "https://example.com/store",
    });
    expect(subject).toContain("a few things needed");
    expect(text).toContain("K & Jassy Shop LLC");
    expect(text).toContain("seller's permit");
    expect(text).toContain("can't approve your application until this is on file");
    expect(text).toContain(base.resumeUrl);
    expect(text).toContain("168 hours");
  });

  it("asks for channel evidence only when none was provided", () => {
    const missing = buildApplicationConfirmationEmail({ ...base, channelEvidenceUrl: null });
    expect(missing.text).toContain("Channel evidence");

    const provided = buildApplicationConfirmationEmail({
      ...base,
      channelEvidenceUrl: "https://example.com/store",
    });
    expect(provided.text).not.toContain("Channel evidence");
    // The permit ask is still there either way.
    expect(provided.text).toContain("seller's permit");
  });
});
