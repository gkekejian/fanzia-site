import { Suspense } from "react";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberOffers } from "@/components/member/MemberOffers";

export default async function MemberOffersPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <Suspense fallback={<p aria-live="polite">Loading…</p>}>
        <MemberOffers />
      </Suspense>
    </>
  );
}
