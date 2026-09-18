/**
 * Small "INTERNAL" badge for the internal buyer account — rendered on
 * order/invoice/allocation rows so anyone reading can see at a glance
 * which volume was Fanzia's own (Fanzia-as-client design 2026-09-18 §1.3).
 * Not inserted into any page yet; the coordinator wires it.
 */
export function InternalBadge() {
  return (
    <span
      title="Our own vending restock order (Fanzia Vending — Internal)"
      style={{
        display: "inline-block",
        fontSize: "0.65rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "0.15rem 0.45rem",
        borderRadius: "0.25rem",
        background: "var(--fz-muted-bg, #eef2f7)",
        color: "var(--fz-muted, #4b5563)",
        border: "1px solid var(--fz-border, #d1d5db)",
        whiteSpace: "nowrap",
      }}
    >
      INTERNAL
    </span>
  );
}
