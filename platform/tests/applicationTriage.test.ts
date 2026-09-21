import { describe, it, expect } from "vitest";
import { scoreApplication } from "@/lib/applications/triage";
import { applicationSchema } from "@/lib/validation/application";
import { validApplicationInput } from "@/tests/applicationFixture";

/**
 * Owner direction 2026-09-19: a missing channel link is not a deficiency
 * for brick-and-mortar style buyers (smoke shops, convenience stores) —
 * it only matters when the applicant claims to sell live and shows
 * nowhere to find them.
 */
describe("application triage channel handling", () => {
  const base = validApplicationInput();

  it("does not flag a smoke shop with no channel link", () => {
    const { reasons, score } = scoreApplication({ ...base, channelType: "smoke_shop_convenience" });
    expect(reasons.some((r) => r.toLowerCase().includes("channel"))).toBe(false);
    expect(score).toBe(0);
  });

  it("flags a live seller with no channel link", () => {
    const { reasons } = scoreApplication({ ...base, channelType: "live_seller" });
    expect(reasons.some((r) => r.includes("Live seller"))).toBe(true);
  });

  it("does not flag a live seller that provided a channel link", () => {
    const { reasons } = scoreApplication({
      ...base,
      channelType: "live_seller",
      channelEvidenceUrl: "https://whatnot.com/user/testshop",
    });
    expect(reasons.some((r) => r.toLowerCase().includes("channel"))).toBe(false);
  });
});

describe("application product interests", () => {
  it("rejects an empty product interests list (mandatory since 2026-09-20)", () => {
    const parsed = applicationSchema.safeParse(validApplicationInput({ productInterests: [] }));
    expect(parsed.success).toBe(false);
  });

  it("accepts a list of product interests", () => {
    const parsed = applicationSchema.safeParse(
      validApplicationInput({ productInterests: ["Pokémon", "Sports cards"] }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.productInterests).toEqual(["Pokémon", "Sports cards"]);
  });

  it("defaults online presence to empty when not provided", () => {
    const parsed = applicationSchema.safeParse(validApplicationInput());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.onlinePresence).toBe("");
  });
});

describe("application intake hardening (2026-09-20)", () => {
  it("accepts a fully complete application", () => {
    expect(applicationSchema.safeParse(validApplicationInput()).success).toBe(true);
  });

  it("rejects a non-US state", () => {
    expect(applicationSchema.safeParse(validApplicationInput({ state: "ON" })).success).toBe(false);
    expect(applicationSchema.safeParse(validApplicationInput({ formationState: "XX" })).success).toBe(false);
  });

  it("normalizes lowercase state codes to uppercase", () => {
    const parsed = applicationSchema.safeParse(validApplicationInput({ state: "ca", formationState: "tx" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.state).toBe("CA");
      expect(parsed.data.formationState).toBe("TX");
    }
  });

  it("rejects a non-US entity type", () => {
    expect(applicationSchema.safeParse(validApplicationInput({ entityType: "ltd" })).success).toBe(false);
  });

  it("rejects a missing AI disclosure acceptance", () => {
    expect(applicationSchema.safeParse(validApplicationInput({ aiDisclosureAccepted: false })).success).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(applicationSchema.safeParse(validApplicationInput({ signatureName: "" })).success).toBe(false);
  });

  it("rejects a zero monthly volume", () => {
    expect(applicationSchema.safeParse(validApplicationInput({ expectedMonthlyVolumeUsd: 0 })).success).toBe(false);
  });

  it("accepts form-data string shapes for numbers and checkboxes", () => {
    const parsed = applicationSchema.safeParse(
      validApplicationInput({
        locationCount: "3",
        expectedMonthlyVolumeUsd: "5000",
        yearsInBusiness: "10",
        termsAccepted: "on",
        aiDisclosureAccepted: "true",
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.locationCount).toBe(3);
      expect(parsed.data.expectedMonthlyVolumeUsd).toBe(5000);
      expect(parsed.data.termsAccepted).toBe(true);
    }
  });
});
