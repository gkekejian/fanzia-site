import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { MemberNav } from "@/components/MemberNav";
import { MemberCatalog } from "@/components/member/MemberCatalog";

export default async function MemberCatalogPage() {
  const buyer = await requireBuyerPageUser();
  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <MemberCatalog />
    </>
  );
}
