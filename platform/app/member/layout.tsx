import type { ReactNode } from "react";
import { getOrderRules } from "@/lib/invoicing/orderRules";
import { OrderRulesProvider } from "@/components/member/OrderRulesContext";

/**
 * Buyer area shell: loads the live order rules once per request and shows
 * the owner's pause message (Settings → Pause all ordering) on every
 * buyer page, so nobody builds a cart they can't submit without knowing.
 */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const rules = await getOrderRules();
  return (
    <OrderRulesProvider rules={rules}>
      {rules.paused && (
        <div className="notice-banner" role="status">
          {rules.pausedMessage}
        </div>
      )}
      {children}
    </OrderRulesProvider>
  );
}
