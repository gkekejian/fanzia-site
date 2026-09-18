"use client";

import { formatMoney } from "@/lib/format";
import {
  ORDER_MINIMUM_MINOR,
  SMALL_ORDER_FEE_MINOR,
  SMALL_ORDER_THRESHOLD_MINOR,
} from "@/lib/invoicing/rules";
import { milestoneProgress } from "@/lib/member/shopping";

/**
 * Dual-milestone progress bar (UX brief pattern #4): milestone 1 at $500
 * ("Submit request unlocks"), milestone 2 at $750 ("$25 small-order fee
 * drops off"). Framed as goals, not penalties.
 */
export function MilestoneProgress({ subtotalMinor }: { subtotalMinor: number }) {
  const p = milestoneProgress(subtotalMinor);

  return (
    <div className="milestone" aria-live="polite">
      <div className="milestone-message">{p.message}</div>
      <div
        className="milestone-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={750}
        aria-valuenow={Math.min(750, Math.round(subtotalMinor / 100))}
        aria-label={`Draft subtotal ${formatMoney(subtotalMinor)} of $750 fee-free milestone`}
      >
        <div className="milestone-fill" style={{ width: `${p.barPct}%` }} />
        <div
          className={`milestone-marker ${p.minMet ? "milestone-marker-hit" : ""}`}
          style={{ left: `${p.minMarkerPct}%` }}
          title={`$500 minimum — ${p.minMet ? "met" : "submit unlocks here"}`}
        />
      </div>
      <div className="milestone-labels">
        <span className={p.minMet ? "milestone-hit" : ""}>
          {formatMoney(ORDER_MINIMUM_MINOR)} — submit unlocks{p.minMet ? " ✓" : ""}
        </span>
        <span className={!p.feeApplies ? "milestone-hit" : ""}>
          {formatMoney(SMALL_ORDER_THRESHOLD_MINOR)} — {formatMoney(SMALL_ORDER_FEE_MINOR)} fee drops
          {!p.feeApplies ? " ✓" : ""}
        </span>
      </div>
    </div>
  );
}
