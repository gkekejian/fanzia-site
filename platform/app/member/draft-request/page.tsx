import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { DraftRequestReview } from "@/components/member/DraftRequestReview";

export default async function DraftRequestPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <DraftRequestReview />
    </>
  );
}
