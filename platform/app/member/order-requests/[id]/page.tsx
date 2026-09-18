import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { ExpiredOfferPrompt } from "@/components/member/ExpiredOfferPrompt";

export default async function MemberOrderRequestPage({ params }: { params: { id: string } }) {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <ExpiredOfferPrompt requestId={params.id} />
    </>
  );
}
