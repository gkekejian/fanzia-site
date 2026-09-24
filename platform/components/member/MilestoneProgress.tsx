"use client";

import { formatMoney } from "@/lib/format";
import { milestoneProgress } from "@/lib/member/shopping";
import { useOrderRules } from "./OrderRulesContext";

/**
 * Dual-milestone progress bar (UX brief pattern #4): milestone 1 at the
 * order minimum ("Submit request unlocks"), milestone 2 at the small-order
 * threshold (fee drops off). Amounts come from Settings via
 * OrderRulesContext. Framed as goals, not penalties.
 */
export function MilestoneProgress({ subtotalMinor }: { subtotalMinor: number }) {
  const rules = useOrderRules();
  const p = milestoneProgress(subtotalMinor, rules);
  const feeOn = rules.smallOrderFeeMinor > 0;
  const barMaxDollars = Math.round(Math.max(feeOn ? rules.smallOrderThresholdMinor : 0, rules.minimumMinor, 1) / 100);

  return (
    <div className="milestone" aria-live="polite">
      <div className="milestone-message">{p.message}</div>
      <div
        className="milestone-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={barMaxDollars}
        aria-valuenow={Math.min(barMaxDollars, Math.round(subtotalMinor / 100))}
        aria-label={`Draft subtotal ${formatMoney(subtotalMinor)} of ${formatMoney(barMaxDollars * 100)}`}
      >
        <div className="milestone-fill" style={{ width: `${p.barPct}%` }} />
        <div
          className={`milestone-marker ${p.minMet ? "milestone-marker-hit" : ""}`}
          style={{ left: `${p.minMarkerPct}%` }}
          title={`${formatMoney(rules.minimumMinor)} minimum — ${p.minMet ? "met" : "submit unlocks here"}`}
        />
      </div>
      <div className="milestone-labels">
        <span className={p.minMet ? "milestone-hit" : ""}>
          {formatMoney(rules.minimumMinor)} — submit unlocks{p.minMet ? " ✓" : ""}
        </span>
        {feeOn && (
          <span className={!p.feeApplies ? "milestone-hit" : ""}>
            {formatMoney(rules.smallOrderThresholdMinor)} — {formatMoney(rules.smallOrderFeeMinor)} fee drops
            {!p.feeApplies ? " ✓" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
