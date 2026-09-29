import { Suspense } from "react";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberWants } from "@/components/member/MemberWants";

export default async function MemberWantsPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <Suspense fallback={<p aria-live="polite">Loading…</p>}>
        <MemberWants />
      </Suspense>
    </>
  );
}
