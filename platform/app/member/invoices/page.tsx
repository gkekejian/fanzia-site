import { Suspense } from "react";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberInvoices } from "@/components/member/MemberInvoices";

export default async function MemberInvoicesPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <Suspense fallback={<p aria-live="polite">Loading…</p>}>
        <MemberInvoices />
      </Suspense>
    </>
  );
}
