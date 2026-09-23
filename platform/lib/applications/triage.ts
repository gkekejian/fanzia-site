import type { ApplicationInput } from "@/lib/validation/application";

/**
 * Triage is sorting, never adjudication (build prompt §8: "Scoring may
 * sort the review queue but must never auto-decline a legitimate
 * applicant"). This function's only caller is the review-queue sort order;
 * nothing reads this score to auto-approve, auto-decline, or auto-waitlist.
 * Every flag returned here must be a plain-language reason a reviewer can
 * read directly, not an opaque numeric code.
 *
 * The score is a count of concern points: HIGHER means MORE to verify,
 * not a better applicant. 0 is a clean application.
 */

/**
 * Maximum possible score, declared explicitly so the admin UI can render
 * "X of N" honestly. Composition: no seller's permit (+2) plus at most one
 * of the two +1 rules — the channel-link rule only applies to live sellers
 * and the out-of-state rule only to non-live sellers, so they are mutually
 * exclusive. Update this if a rule is added or a weight changes.
 */
export const TRIAGE_MAX_SCORE = 3;

const REASON_NO_PERMIT = "No seller's permit number provided yet.";
const REASON_NO_CHANNEL =
  "Live seller with no channel link provided — worth verifying where they sell.";
const REASON_OUT_OF_STATE =
  "Out-of-state applicant outside the LA-metro core buyer profile — not disqualifying, just worth a second look.";

/** Points each reason contributes — used by the admin UI to show a breakdown. */
export const TRIAGE_REASON_POINTS: Record<string, number> = {
  [REASON_NO_PERMIT]: 2,
  [REASON_NO_CHANNEL]: 1,
  [REASON_OUT_OF_STATE]: 1,
};

export type TriageBand = {
  label: string;
  tone: "ok" | "warn" | "bad";
};

/** Plain-language band for a score, so the UI never shows a bare number. */
export function triageBand(score: number): TriageBand {
  if (score <= 0) return { label: "Clear", tone: "ok" };
  if (score === 1) return { label: "Needs attention", tone: "warn" };
  return { label: "Check before approving", tone: "bad" };
}

export function scoreApplication(input: ApplicationInput): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (!input.sellersPermitNumber) {
    reasons.push(REASON_NO_PERMIT);
    score += 2;
  }
  // A missing channel link is not a deficiency for brick-and-mortar style
  // buyers (smoke shops, convenience stores, etc.) — it only matters when
  // the applicant claims to sell live and shows nowhere to find them
  // (owner direction 2026-09-19).
  if (input.channelType === "live_seller" && !input.channelEvidenceUrl) {
    reasons.push(REASON_NO_CHANNEL);
    score += 1;
  }
  if (input.state.toUpperCase() !== "CA" && input.channelType !== "live_seller") {
    reasons.push(REASON_OUT_OF_STATE);
    score += 1;
  }

  return { score, reasons };
}
