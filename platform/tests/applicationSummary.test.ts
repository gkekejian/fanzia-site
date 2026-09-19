import { describe, it, expect } from "vitest";
import {
  buildBusinessSummary,
  formatSummaryEmail,
  runApplicationChecks,
  type ApplicationLike,
} from "@/lib/applications/summary";

const FULL_APP: ApplicationLike = {
  businessLegalName: "Looty's Lair",
  channelType: "other",
  contactName: "Richard Darlington",
  contactEmail: "richard@example.com",
  addressLine1: "123 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US",
  sellersPermitNumber: "12-3456789",
  channelEvidenceUrl: "https://lootyslair.com",
  onlinePresence: "Whatnot: lootyslair",
  productInterests: ["Pokémon", "Magic: The Gathering"],
  emailVerifiedAt: new Date("2026-09-19T10:00:00Z"),
};

const BARE_APP: ApplicationLike = {
  businessLegalName: "K & Jassy Shop LLC",
  channelType: "other",
  contactName: "Kevin Sorto",
  contactEmail: "kjassyshop@gmail.com",
  addressLine1: "456 Elm St",
  city: "Los Angeles",
  state: "CA",
  postalCode: "90001",
  country: "US",
};

describe("application summary + checks", () => {
  it("buildBusinessSummary renders every field", () => {
    const rows = buildBusinessSummary(FULL_APP, [{ docType: "sellers_permit", originalFilename: "permit.pdf" }]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Business"]).toBe("Looty's Lair");
    expect(byLabel["Contact"]).toContain("Richard Darlington");
    expect(byLabel["Contact"]).toContain("richard@example.com");
    expect(byLabel["Location"]).toContain("Austin, TX 78701");
    expect(byLabel["Store type"]).toBe("other");
    expect(byLabel["Channel evidence"]).toBe("https://lootyslair.com");
    expect(byLabel["Products of interest"]).toContain("Pokémon");
    expect(byLabel["Seller's permit"]).toBe("12-3456789");
    expect(byLabel["Documents on file"]).toContain("1 (sellers permit)");
  });

  it("buildBusinessSummary handles a bare application", () => {
    const rows = buildBusinessSummary(BARE_APP, []);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Channel evidence"]).toBe("Not provided");
    expect(byLabel["Online presence"]).toBe("Not provided");
    expect(byLabel["Products of interest"]).toBe("Not specified");
    expect(byLabel["Seller's permit"]).toBe("Not provided");
    expect(byLabel["Documents on file"]).toBe("None yet");
  });

  it("runApplicationChecks passes a complete application", () => {
    const checks = runApplicationChecks(FULL_APP, [{ docType: "sellers_permit", originalFilename: "permit.pdf" }]);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId["permit_number"]?.status).toBe("pass");
    expect(byId["permit_document"]?.status).toBe("pass");
    expect(byId["channel_evidence"]?.status).toBe("pass");
    expect(byId["online_presence"]?.status).toBe("pass");
    expect(byId["product_interests"]?.status).toBe("pass");
    expect(byId["email_verified"]?.status).toBe("pass");
  });

  it("runApplicationChecks fails a bare application where it should", () => {
    const checks = runApplicationChecks(BARE_APP, []);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId["permit_number"]?.status).toBe("fail");
    expect(byId["permit_document"]?.status).toBe("fail");
    expect(byId["permit_document"]?.detail).toContain("Required before approval");
    expect(byId["channel_evidence"]?.status).toBe("fail");
    // Optional fields are unknown, not fail.
    expect(byId["online_presence"]?.status).toBe("unknown");
    expect(byId["product_interests"]?.status).toBe("unknown");
    expect(byId["email_verified"]?.status).toBe("unknown");
  });

  it("formatSummaryEmail includes summary, triage, flags, and checks", () => {
    const text = formatSummaryEmail(
      buildBusinessSummary(BARE_APP, []),
      runApplicationChecks(BARE_APP, []),
      1,
      ["No channel evidence link provided"],
    );
    expect(text).toContain("Business summary");
    expect(text).toContain("K & Jassy Shop LLC");
    expect(text).toContain("Triage score: 1");
    expect(text).toContain("No channel evidence link provided");
    expect(text).toContain("Checks");
    expect(text).toContain("[FAIL] Seller's permit copy on file");
    expect(text).toContain("[?] Online presence described");
  });
});
