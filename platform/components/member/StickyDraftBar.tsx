"use client";

import { formatMoney } from "@/lib/format";
import { draftTotals, milestoneProgress } from "@/lib/member/shopping";

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
  const totals = draftTotals(lines, priceById);
  if (totals.units === 0) return null;
  const progress = milestoneProgress(totals.subtotalMinor);

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
          {progress.minMet ? "Draft ready ✓" : `$${(progress.toMinimumMinor / 100).toFixed(0)} to $500 minimum`}
        </span>
        <span className="sticky-draft-bar-go" aria-hidden="true">
          →
        </span>
      </a>
    </>
  );
}
