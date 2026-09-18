/**
 * Fanzia-as-client (design doc 2026-09-18 §1): the internal buyer account.
 * Provisioning is a direct owner action, not the application flow —
 * Fanzia does not apply to itself (design §1.2). The idempotency decision
 * here is pure (fixture data only) so it is unit-testable without a
 * database; the API route at app/api/admin/internal-buyer/route.ts uses it.
 */

export const INTERNAL_BUYER_LEGAL_NAME = "Fanzia Vending — Internal";

/** Allowed values for the `internal_transfer_pricing` settings key. */
export const INTERNAL_TRANSFER_PRICING = ["same_price", "at_cost"] as const;
export type InternalTransferPricing = (typeof INTERNAL_TRANSFER_PRICING)[number];

/**
 * Idempotent provisioning decision: when an account with kind='internal'
 * already exists, reuse it — a second internal buyer must never be
 * created. Only `kind` is checked; the legal name is display-only and may
 * change without invalidating the check.
 */
export function internalBuyerProvisionDecision(
  accounts: { kind: "internal" | "external" }[],
): "reuse" | "create" {
  return accounts.some((a) => a.kind === "internal") ? "reuse" : "create";
}
