import { notFound } from "next/navigation";
import { requireBuyerPageUser } from "@/lib/auth/buyerPageGuard";
import { getMemberCatalog } from "@/lib/catalog/queries";
import { MemberNav } from "@/components/MemberNav";
import { ProductDetailClient } from "@/components/member/ProductDetailClient";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const buyer = await requireBuyerPageUser();
  const products = await getMemberCatalog();
  const product = products.find((p) => p.id === params.id);
  if (!product) notFound();

  return (
    <>
      <MemberNav contactName={buyer.contactName} />
      <ProductDetailClient product={product} products={products} />
    </>
  );
}
