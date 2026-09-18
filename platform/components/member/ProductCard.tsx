"use client";

import { formatMoney } from "@/lib/format";
import {
  perPackPriceMinor,
  sellableUnitLabel,
  unitNoun,
  type ShoppingProduct,
} from "@/lib/member/shopping";
import { AvailabilityChip } from "./AvailabilityChip";
import { AddToDraftButton } from "./AddToDraftButton";

/**
 * Unit-first product card (UX brief pattern #1): the sellable unit is the
 * top line ("Booster Box — 36 packs"), the price anchors per box, and the
 * per-pack figure lives in the meta line only — never two competing
 * prices. Max two badges (Trending + availability).
 */
export function ProductCard({
  product,
  qty,
  onQtyChange,
}: {
  product: ShoppingProduct;
  qty: number;
  onQtyChange: (productId: string, qty: number) => void;
}) {
  const unitLabel = sellableUnitLabel(product.name, product.packsPerUnit);
  const unit = unitNoun(product.name).toLowerCase();
  const perPack = perPackPriceMinor(product.priceMinor, product.packsPerUnit);

  return (
    <article className="product-card">
      <a href={`/member/catalog/${product.id}`} className="product-card-link" aria-label={`View ${product.name}`}>
        <div className="product-card-unit">{unitLabel}</div>
        <h3 className="product-card-name">{product.name}</h3>
      </a>
      <div className="product-card-badges">
        {product.trending && (
          <span
            className="chip chip-hot"
            title="Among the most-ordered products in the last 30 days"
          >
            🔥 Trending
          </span>
        )}
        <AvailabilityChip product={product} />
      </div>
      <div className="product-card-price">
        {formatMoney(product.priceMinor, product.currencyCode)}
        <span className="product-card-per"> per {unit}</span>
      </div>
      <div className="product-card-meta">
        {perPack !== null && product.packsPerUnit > 1 && (
          <>≈ {formatMoney(perPack, product.currencyCode)} / pack · </>
        )}
        min 1 {unit}
        {product.marginMinor !== null && product.marginBps !== null && (
          <>
            <br />
            <span title="Your potential retail margin per unit vs manufacturer MSRP — an estimate, not a promise">
              Est. retail margin {formatMoney(product.marginMinor, product.currencyCode)} (
              {(product.marginBps / 100).toFixed(1)}%) vs MSRP
            </span>
          </>
        )}
      </div>
      <div className="product-card-action">
        <AddToDraftButton
          productId={product.id}
          productName={product.name}
          qty={qty}
          onChange={onQtyChange}
        />
      </div>
    </article>
  );
}
