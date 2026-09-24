"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_ORDER_RULES, type OrderRules } from "@/lib/invoicing/rules";

/**
 * Live order rules (minimum, fee, case-only, pause) from the owner's
 * Settings, provided once by app/member/layout.tsx so every buyer-side
 * component shows the same numbers the server enforces.
 */
const OrderRulesContext = createContext<OrderRules>(DEFAULT_ORDER_RULES);

export function OrderRulesProvider({ rules, children }: { rules: OrderRules; children: ReactNode }) {
  return <OrderRulesContext.Provider value={rules}>{children}</OrderRulesContext.Provider>;
}

export function useOrderRules(): OrderRules {
  return useContext(OrderRulesContext);
}

/** Qty step for a product: its case size when case-only mode applies, else 1. */
export function useQtyStep(unitsPerCase: number | null | undefined): number {
  const { caseOnly } = useOrderRules();
  return caseOnly && unitsPerCase && unitsPerCase > 1 ? unitsPerCase : 1;
}
