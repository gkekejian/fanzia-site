"use client";

import { useState } from "react";

/**
 * Shared two-step in-page confirmation for consequential admin actions
 * (record an approve/decline decision, void an invoice, publish, send…).
 * Follows the publish-button pattern: the first click arms the button
 * ("Confirm …"), the second click fires. Deliberately NOT window.confirm —
 * native dialogs are silently auto-dismissed by browser automation, which
 * turns the action into a dead button with no error.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  danger = false,
  detail,
}: {
  /** Button text before arming, e.g. "Record decision". */
  label: string;
  /** Button text once armed, e.g. "Confirm — record decision". */
  confirmLabel: string;
  /** Fires on the second click. May be async. */
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  /** Use the danger styling (declines, voids, rejects). */
  danger?: boolean;
  /** Extra context shown while armed, e.g. what the action will do. */
  detail?: string;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <button
        type="button"
        className={`btn${danger ? " btn-danger" : ""}`}
        disabled={disabled}
        aria-pressed={armed}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          void onConfirm();
        }}
      >
        {armed ? confirmLabel : label}
      </button>
      {armed && !disabled && (
        <>
          {detail && (
            <span role="status" style={{ fontSize: "0.85rem", color: "var(--fz-muted)" }}>
              {detail}
            </span>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setArmed(false)}>
            Cancel
          </button>
        </>
      )}
    </span>
  );
}
