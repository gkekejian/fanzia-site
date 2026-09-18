"use client";

import { curatedRows, type ShoppingProduct } from "@/lib/member/shopping";
import { ProductCard } from "./ProductCard";

/**
 * Curated discovery rows for a small catalog: real trending data, honest
 * restocks, and Japanese imports. A row only renders when it has content —
 * never an empty shelf that makes the catalog feel dead.
 */
export function CuratedRows({
  products,
  qtyById,
  onQtyChange,
}: {
  products: ShoppingProduct[];
  qtyById: Map<string, number>;
  onQtyChange: (productId: string, qty: number) => void;
}) {
  const rows = curatedRows(products);
  const entries: { title: string; sub: string; items: ShoppingProduct[] }[] = [
    {
      title: "Bestsellers for card shops",
      sub: "Most-ordered by stores like yours in the last 30 days",
      items: rows.bestsellers,
    },
    {
      title: "Restocked this week",
      sub: "Checked fresh with our source",
      items: rows.restocked,
    },
    {
      title: "Japanese imports",
      sub: "Japanese-language product on the shelf",
      items: rows.japaneseImports,
    },
  ];

  return (
    <>
      {entries
        .filter((e) => e.items.length > 0)
        .map((e) => (
          <section key={e.title} className="curated-section" aria-label={e.title}>
            <div className="curated-head">
              <h2>{e.title}</h2>
              <p>{e.sub}</p>
            </div>
            <div className="curated-row">
              {e.items.map((p) => (
                <div key={p.id} className="curated-card">
                  <ProductCard product={p} qty={qtyById.get(p.id) ?? 0} onQtyChange={onQtyChange} />
                </div>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
