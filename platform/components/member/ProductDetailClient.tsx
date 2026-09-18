"use client";

import type { MemberProductDTO } from "@/lib/catalog/dto";
import { ProductDetail } from "./ProductDetail";
import { useDraft } from "./useDraft";

/** Client wrapper: wires the detail view to the account-backed draft. */
export function ProductDetailClient({
  product,
  products,
}: {
  product: MemberProductDTO;
  products: MemberProductDTO[];
}) {
  const { qtyById, setQty } = useDraft();
  return <ProductDetail product={product} products={products} qtyById={qtyById} onQtyChange={setQty} />;
}
