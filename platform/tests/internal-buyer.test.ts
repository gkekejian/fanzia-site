/**
 * Internal buyer (Fanzia-as-client) unit tests.
 * Fixture data only — no database, no network. Covers:
 *  - the small-order fee rule: internal accounts never pay it; external
 *    accounts pay it only under $750 (all amounts in minor units);
 *  - provisioning idempotency: a second provision call must reuse the
 *    existing internal account, never insert another one.
 */
import { describe, it, expect } from "vitest";
import {
  SMALL_ORDER_FEE_MINOR,
  SMALL_ORDER_THRESHOLD_MINOR,
  computeSmallOrderFee,
} from "@/lib/invoicing/rules";
import {
  INTERNAL_BUYER_LEGAL_NAME,
  internalBuyerProvisionDecision,
} from "@/lib/internalBuyer";

describe("internal buyer small-order fee", () => {
  it("never charges the internal buyer, even well under the threshold", () => {
    expect(computeSmallOrderFee(0, "internal")).toBe(0);
    expect(computeSmallOrderFee(1, "internal")).toBe(0);
    expect(computeSmallOrderFee(SMALL_ORDER_THRESHOLD_MINOR - 1, "internal")).toBe(0);
  });

  it("never charges the internal buyer above the threshold either", () => {
    expect(computeSmallOrderFee(SMALL_ORDER_THRESHOLD_MINOR, "internal")).toBe(0);
    expect(computeSmallOrderFee(1_000_000, "internal")).toBe(0);
  });

  it("charges external buyers under $750 and not at/above it", () => {
    expect(computeSmallOrderFee(SMALL_ORDER_THRESHOLD_MINOR - 1, "external")).toBe(
      SMALL_ORDER_FEE_MINOR,
    );
    expect(computeSmallOrderFee(SMALL_ORDER_THRESHOLD_MINOR, "external")).toBe(0);
    expect(computeSmallOrderFee(1_000_000, "external")).toBe(0);
  });

  it("boundary: $749.99 external pays, $750.00 external does not", () => {
    expect(computeSmallOrderFee(74999, "external")).toBe(SMALL_ORDER_FEE_MINOR);
    expect(computeSmallOrderFee(75000, "external")).toBe(0);
  });
});

describe("internal buyer provisioning idempotency", () => {
  const internalFixture = {
    id: "acct-internal-1",
    legalName: INTERNAL_BUYER_LEGAL_NAME,
    kind: "internal" as const,
  };
  const externalFixture = {
    id: "acct-external-1",
    legalName: "Some Smoke Shop",
    kind: "external" as const,
  };

  it("decides 'create' when no accounts exist yet", () => {
    expect(internalBuyerProvisionDecision([])).toBe("create");
  });

  it("decides 'create' when only external accounts exist", () => {
    expect(internalBuyerProvisionDecision([externalFixture])).toBe("create");
  });

  it("decides 'reuse' when an internal account already exists", () => {
    expect(internalBuyerProvisionDecision([internalFixture])).toBe("reuse");
    expect(internalBuyerProvisionDecision([externalFixture, internalFixture])).toBe("reuse");
  });

  it("matches on kind, not on legal name (renames do not trigger a second insert)", () => {
    const renamed = { ...internalFixture, legalName: "Fanzia Vending" };
    expect(internalBuyerProvisionDecision([renamed])).toBe("reuse");
  });
});
