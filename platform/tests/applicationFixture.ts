import type { ApplicationInput } from "@/lib/validation/application";

/**
 * Shared valid application input for tests. Mirrors every mandatory field
 * in lib/validation/application.ts (intake hardening 2026-09-20) so each
 * test file doesn't have to repeat the full shape.
 */
export function validApplicationInput(
  overrides: { [K in keyof ApplicationInput]?: unknown } = {},
): ApplicationInput {
  return {
    businessLegalName: "Test Shop LLC",
    dba: "",
    entityType: "llc",
    formationState: "CA",
    sosEntityNumber: "",
    channelType: "smoke_shop_convenience",
    addressLine1: "1 Main St",
    addressLine2: "",
    city: "Glendale",
    state: "CA",
    postalCode: "91201",
    country: "US",
    contactName: "Jane Doe",
    contactEmail: "jane@example.com",
    locationCount: 2,
    yearsInBusiness: 5,
    expectedMonthlyVolumeUsd: 3000,
    resaleCertNumber: "SR-123456789",
    resaleCertState: "CA",
    channelEvidenceUrl: "",
    sellersPermitNumber: "123-456789",
    productInterests: ["Pokémon"],
    onlinePresence: "",
    signatureName: "Jane Doe",
    termsAccepted: true,
    aiDisclosureAccepted: true,
    website: "",
    turnstileToken: null,
    ...overrides,
  } as ApplicationInput;
}
