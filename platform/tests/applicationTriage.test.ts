import { describe, it, expect } from "vitest";
import { scoreApplication } from "@/lib/applications/triage";
import { applicationSchema } from "@/lib/validation/application";

/**
 * Owner direction 2026-09-19: a missing channel link is not a deficiency
 * for brick-and-mortar style buyers (smoke shops, convenience stores) —
 * it only matters when the applicant claims to sell live and shows
 * nowhere to find them.
 */
describe("application triage channel handling", () => {
  const base = {
    businessLegalName: "Test Shop LLC",
    addressLine1: "1 Main St",
    addressLine2: "",
    city: "Glendale",
    state: "CA",
    postalCode: "91201",
    country: "US",
    contactName: "Jane Doe",
    contactEmail: "jane@example.com",
    sellersPermitNumber: "123-456789",
    channelEvidenceUrl: "",
    termsAccepted: true as const,
    website: "",
    turnstileToken: null,
    productInterests: [],
    onlinePresence: "",
  };

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
  it("defaults to an empty list when not provided", () => {
    const parsed = applicationSchema.safeParse({
      businessLegalName: "Test Shop LLC",
      channelType: "smoke_shop_convenience",
      addressLine1: "1 Main St",
      city: "Glendale",
      state: "CA",
      postalCode: "91201",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      termsAccepted: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.productInterests).toEqual([]);
  });

  it("accepts a list of product interests", () => {
    const parsed = applicationSchema.safeParse({
      businessLegalName: "Test Shop LLC",
      channelType: "smoke_shop_convenience",
      addressLine1: "1 Main St",
      city: "Glendale",
      state: "CA",
      postalCode: "91201",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      termsAccepted: true,
      productInterests: ["Pokémon", "Sports cards"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.productInterests).toEqual(["Pokémon", "Sports cards"]);
  });

  it("defaults online presence to empty when not provided", () => {
    const parsed = applicationSchema.safeParse({
      businessLegalName: "Test Shop LLC",
      channelType: "smoke_shop_convenience",
      addressLine1: "1 Main St",
      city: "Glendale",
      state: "CA",
      postalCode: "91201",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      termsAccepted: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.onlinePresence).toBe("");
  });
});
