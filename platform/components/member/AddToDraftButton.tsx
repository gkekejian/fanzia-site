"use client";

import { useEffect, useRef } from "react";
import { useOrderRules, useQtyStep } from "./OrderRulesContext";

/**
 * One-tap "Add to draft" that morphs into an inline − qty + stepper after
 * the first add. Quantities step in the sellable unit (boxes, cases…).
 * Press-and-hold + (or −) quick-increments by 5 — the thumb-zone pattern
 * for busy phone ordering.
 */
export function AddToDraftButton({
  productId,
  productName,
  qty,
  onChange,
  compact = false,
  unitsPerCase = null,
}: {
  productId: string;
  productName: string;
  qty: number;
  onChange: (productId: string, qty: number) => void;
  compact?: boolean;
  /** Case size; with case-only mode on, the stepper moves in whole cases. */
  unitsPerCase?: number | null;
}) {
  const unit = useQtyStep(unitsPerCase);
  // Allocation mode: the same control edits the interest list ("I want this").
  const { allocationMode } = useOrderRules();
  const listName = allocationMode ? "your wants" : "draft";
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const qtyRef = useRef(qty);
  qtyRef.current = qty;

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (holdInterval.current) clearInterval(holdInterval.current);
    },
    [],
  );

  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimer.current = null;
    holdInterval.current = null;
  }

  function startHold(step: 1 | -1) {
    clearHold();
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(() => {
        onChange(productId, Math.max(0, qtyRef.current + step * unit * 5));
      }, 160);
    }, 450);
  }

  if (qty <= 0) {
    return (
      <button
        type="button"
        className={`btn ${compact ? "btn-compact" : ""}`}
        onClick={() => onChange(productId, unit)}
        aria-label={unit > 1 ? `Add one case (${unit} units) of ${productName} to ${listName}` : `Add ${productName} to ${listName}`}
      >
        {allocationMode ? (unit > 1 ? `I want a case of ${unit}` : "I want this") : unit > 1 ? `Add case of ${unit}` : "Add to draft"}
      </button>
    );
  }

  const btn = compact ? "btn btn-compact btn-secondary stepper-btn" : "btn btn-secondary stepper-btn";
  return (
    <div className="stepper" role="group" aria-label={`Quantity of ${productName} in ${listName}`}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(productId, Math.max(0, qty - unit))}
        onPointerDown={() => startHold(-1)}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        aria-label={unit > 1 ? `Remove one case of ${productName}` : `Remove one ${productName}`}
      >
        −
      </button>
      <span className="stepper-qty" aria-live="polite">
        {unit > 1 ? `${qty / unit >= 1 && qty % unit === 0 ? qty / unit : (qty / unit).toFixed(1)} cs` : qty}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(productId, qty + unit)}
        onPointerDown={() => startHold(1)}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        aria-label={unit > 1 ? `Add one more case of ${productName}` : `Add one more ${productName}`}
      >
        +
      </button>
    </div>
  );
}
