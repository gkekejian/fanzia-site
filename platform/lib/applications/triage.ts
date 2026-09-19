import type { ApplicationInput } from "@/lib/validation/application";

/**
 * Triage is sorting, never adjudication (build prompt §8: "Scoring may
 * sort the review queue but must never auto-decline a legitimate
 * applicant"). This function's only caller is the review-queue sort order;
 * nothing reads this score to auto-approve, auto-decline, or auto-waitlist.
 * Every flag returned here must be a plain-language reason a reviewer can
 * read directly, not an opaque numeric code.
 */
export function scoreApplication(input: ApplicationInput): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (!input.sellersPermitNumber) {
    reasons.push("No seller's permit number provided yet.");
    score += 2;
  }
  // A missing channel link is not a deficiency for brick-and-mortar style
  // buyers (smoke shops, convenience stores, etc.) — it only matters when
  // the applicant claims to sell live and shows nowhere to find them
  // (owner direction 2026-09-19).
  if (input.channelType === "live_seller" && !input.channelEvidenceUrl) {
    reasons.push("Live seller with no channel link provided — worth verifying where they sell.");
    score += 1;
  }
  if (input.state.toUpperCase() !== "CA" && input.channelType !== "live_seller") {
    reasons.push("Out-of-state applicant outside the LA-metro core buyer profile — not disqualifying, just worth a second look.");
    score += 1;
  }

  return { score, reasons };
}
