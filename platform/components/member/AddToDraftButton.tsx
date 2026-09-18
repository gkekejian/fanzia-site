"use client";

import { useEffect, useRef } from "react";

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
}: {
  productId: string;
  productName: string;
  qty: number;
  onChange: (productId: string, qty: number) => void;
  compact?: boolean;
}) {
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
        onChange(productId, qtyRef.current + step * 5);
      }, 160);
    }, 450);
  }

  if (qty <= 0) {
    return (
      <button
        type="button"
        className={`btn ${compact ? "btn-compact" : ""}`}
        onClick={() => onChange(productId, 1)}
        aria-label={`Add ${productName} to draft`}
      >
        Add to draft
      </button>
    );
  }

  const btn = compact ? "btn btn-compact btn-secondary stepper-btn" : "btn btn-secondary stepper-btn";
  return (
    <div className="stepper" role="group" aria-label={`Quantity of ${productName} in draft`}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(productId, qty - 1)}
        onPointerDown={() => startHold(-1)}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        aria-label={`Remove one ${productName}`}
      >
        −
      </button>
      <span className="stepper-qty" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(productId, qty + 1)}
        onPointerDown={() => startHold(1)}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        aria-label={`Add one more ${productName}`}
      >
        +
      </button>
    </div>
  );
}
