import { Suspense } from "react";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberPayment } from "@/components/member/MemberPayment";

export default async function MemberPaymentPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <Suspense fallback={<p aria-live="polite">Loading…</p>}>
        <MemberPayment />
      </Suspense>
    </>
  );
}
