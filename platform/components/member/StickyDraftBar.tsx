"use client";

import { formatMoney } from "@/lib/format";
import { draftTotals, milestoneProgress } from "@/lib/member/shopping";
import { useOrderRules } from "./OrderRulesContext";

/**
 * Sticky mobile draft bar (thumb-reach): live subtotal · units ·
 * threshold status. Tapping anywhere opens the draft page. This is what
 * makes the catalog feel like a real store.
 */
export function StickyDraftBar({
  lines,
  priceById,
}: {
  lines: { productId: string; qtyRequested: number }[];
  priceById: Map<string, { priceMinor: number }>;
}) {
  const rules = useOrderRules();
  const totals = draftTotals(lines, priceById);
  if (totals.units === 0) return null;
  if (rules.allocationMode) {
    return (
      <>
        <div className="sticky-draft-bar-spacer" aria-hidden="true" />
        <a href="/member/wants" className="sticky-draft-bar" aria-label="Open your wants list">
          <span className="sticky-draft-bar-main">
            <strong>
              {lines.length} product{lines.length === 1 ? "" : "s"} wanted
            </strong>
          </span>
          <span className="sticky-draft-bar-status">Offers arrive by email when stock lands</span>
          <span className="sticky-draft-bar-go" aria-hidden="true">
            →
          </span>
        </a>
      </>
    );
  }
  const progress = milestoneProgress(totals.subtotalMinor, rules);

  return (
    <>
      {/* Spacer so the fixed bar never covers page content. */}
      <div className="sticky-draft-bar-spacer" aria-hidden="true" />
      <a href="/member/draft-request" className="sticky-draft-bar" aria-label="Open your draft request">
        <span className="sticky-draft-bar-main">
          <strong>{formatMoney(totals.subtotalMinor)}</strong>
          <span className="sticky-draft-bar-units">
            {" "}
            · {totals.units} unit{totals.units === 1 ? "" : "s"}
          </span>
        </span>
        <span className="sticky-draft-bar-status">
          {progress.minMet ? "Draft ready ✓" : `${formatMoney(progress.toMinimumMinor)} to ${formatMoney(rules.minimumMinor)} minimum`}
        </span>
        <span className="sticky-draft-bar-go" aria-hidden="true">
          →
        </span>
      </a>
    </>
  );
}
