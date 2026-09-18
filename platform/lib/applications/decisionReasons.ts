/**
 * Canonical decision-reason codes for application adjudication.
 *
 * Owners pick a reason from a dropdown instead of free-typing notes; the
 * human-readable label is what gets stored as `decisionReason` and included
 * in the applicant's decision email. One source of truth shared by the API
 * route (validation) and the admin UI (dropdown options).
 */

export type ApplicationDecision = "approved" | "declined" | "needs_review";

export type DecisionReason = { code: string; label: string };

const OTHER: DecisionReason = { code: "other", label: "Other (add a note below)" };

export const DECISION_REASONS: Record<ApplicationDecision, DecisionReason[]> = {
  approved: [
    { code: "meets_criteria", label: "Meets all wholesale criteria" },
    { code: "verified_reseller", label: "Verified active reseller" },
    { code: "owner_discretion", label: "Approved at owner discretion" },
    OTHER,
  ],
  declined: [
    { code: "missing_documents", label: "Required documents missing or unreadable" },
    { code: "unverifiable_business", label: "Could not verify the business" },
    { code: "no_resale_permit", label: "No valid seller's permit / resale certificate" },
    { code: "ineligible_channel", label: "Sales channel not eligible for wholesale" },
    { code: "below_minimums", label: "Does not meet order minimums" },
    { code: "duplicate_application", label: "Duplicate application" },
    OTHER,
  ],
  needs_review: [
    { code: "docs_need_check", label: "Documents need closer review" },
    { code: "info_unclear", label: "Application info unclear or inconsistent" },
    { code: "owner_followup", label: "Owner follow-up needed" },
    OTHER,
  ],
};

export function isValidReasonCode(decision: ApplicationDecision, code: string): boolean {
  return DECISION_REASONS[decision].some((r) => r.code === code);
}

/** The preselected reason in the UI: the first code for the decision. */
export function defaultReasonCode(decision: ApplicationDecision): string {
  const first = DECISION_REASONS[decision][0];
  if (!first) throw new Error(`No reasons defined for decision "${decision}".`);
  return first.code;
}

export function reasonLabel(decision: ApplicationDecision, code: string): string | null {
  return DECISION_REASONS[decision].find((r) => r.code === code)?.label ?? null;
}

const MAX_NOTE_LENGTH = 500;

/**
 * Compose the stored/emailed reason string from a validated code + optional note.
 * Throws on invalid input — the API route maps these to 400.
 */
export function composeDecisionReason(
  decision: ApplicationDecision,
  code: string,
  note?: string | null,
): string {
  const label = reasonLabel(decision, code);
  if (!label) throw new Error(`Unknown reason code "${code}" for decision "${decision}".`);
  const trimmed = (note ?? "").trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
  if (code === "other") {
    if (!trimmed) throw new Error(`A note is required when the reason is "Other".`);
    return trimmed;
  }
  return trimmed ? `${label} — ${trimmed}` : label;
}
