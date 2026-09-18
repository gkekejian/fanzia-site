"use client";

import { availabilityChip, type ShoppingProduct } from "@/lib/member/shopping";

const KIND_CLASS: Record<string, string> = {
  ok: "chip-ok",
  warn: "chip-warn",
  bad: "chip-bad",
  muted: "chip-muted",
};

/** Honest availability chip on every card — one of In stock / Only N left / Preorder / Out of stock / Not yet checked. */
export function AvailabilityChip({ product }: { product: ShoppingProduct }) {
  const chip = availabilityChip(product);
  return (
    <span className={`chip ${KIND_CLASS[chip.kind]}`} title={chip.detail}>
      {chip.label}
    </span>
  );
}
