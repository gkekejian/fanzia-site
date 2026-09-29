import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account } from "@/db/schema";
import { getCurrentBuyer } from "@/lib/auth/buyerSession";
import { getOrderRules } from "@/lib/invoicing/orderRules";
import { OrderRulesProvider } from "@/components/member/OrderRulesContext";

/**
 * Buyer area shell: loads the live order rules once per request and shows
 * the owner's pause message (Settings → Pause all ordering) on every
 * buyer page, so nobody builds a cart they can't submit without knowing.
 */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  let rules = await getOrderRules();
  if (rules.allocationMode) {
    // The internal vending account keeps ordering directly in either mode.
    const buyer = await getCurrentBuyer().catch(() => null);
    if (buyer) {
      const [acct] = await db.select({ kind: account.kind }).from(account).where(eq(account.id, buyer.accountId)).limit(1);
      if (acct?.kind === "internal") rules = { ...rules, allocationMode: false };
    }
  }
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
