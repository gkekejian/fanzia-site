import { Suspense } from "react";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberOrderRequests } from "@/components/MemberOrderRequests";

export default async function MemberOrderRequestsPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <main className="container">
        <Suspense fallback={<p aria-live="polite">Loading…</p>}>
          <MemberOrderRequests />
        </Suspense>
      </main>
    </>
  );
}
