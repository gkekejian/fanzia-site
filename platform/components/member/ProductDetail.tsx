"use client";

import { formatMoney } from "@/lib/format";
import {
  availabilityChip,
  perPackPriceMinor,
  sellableUnitLabel,
  substituteSuggestions,
  unitNoun,
  unitSpecLines,
  type ShoppingProduct,
} from "@/lib/member/shopping";
import { AvailabilityChip } from "./AvailabilityChip";
import { AddToDraftButton } from "./AddToDraftButton";

/**
 * Product detail view: repeats the unit-first pattern ("Booster Box —
 * 36 packs", price per box) with an "In this box" spec block, the honest
 * availability chip, and ranked substitutes when out of stock.
 */
export function ProductDetail({
  product,
  products,
  qtyById,
  onQtyChange,
}: {
  product: ShoppingProduct;
  products: ShoppingProduct[];
  qtyById: Map<string, number>;
  onQtyChange: (productId: string, qty: number) => void;
}) {
  const qty = qtyById.get(product.id) ?? 0;
  const unitLabel = sellableUnitLabel(product.name, product.packsPerUnit);
  const unit = unitNoun(product.name).toLowerCase();
  const perPack = perPackPriceMinor(product.priceMinor, product.packsPerUnit);
  const chip = availabilityChip(product);
  const outOfStock = chip.label === "Out of stock";
  const substitutes = outOfStock ? substituteSuggestions(product, products) : [];

  return (
    <main className="container product-detail">
      <p>
        <a href="/member/catalog">← Back to catalog</a>
      </p>
      <div className="product-detail-unit">{unitLabel}</div>
      <h1>{product.name}</h1>
      <div className="product-card-badges">
        {product.trending && (
          <span className="chip chip-hot" title="Among the most-ordered products in the last 30 days">
            🔥 Trending
          </span>
        )}
        <AvailabilityChip product={product} />
        {product.requiresImportAcknowledgment && <span className="chip chip-muted">Imported product</span>}
      </div>

      <div className="product-detail-price card">
        <div className="product-detail-price-line">
          <strong>{formatMoney(product.priceMinor, product.currencyCode)}</strong>
          <span className="product-card-per"> per {unit}</span>
        </div>
        <div className="product-card-meta">
          {perPack !== null && product.packsPerUnit > 1 && (
            <>≈ {formatMoney(perPack, product.currencyCode)} / pack · min 1 {unit}</>
          )}
          {product.marginMinor !== null && product.marginBps !== null && (
            <>
              <br />
              <span title="Your potential retail margin per unit vs manufacturer MSRP — an estimate, not a promise">
                Est. retail margin {formatMoney(product.marginMinor, product.currencyCode)} (
                {(product.marginBps / 100).toFixed(1)}%) vs MSRP
              </span>
            </>
          )}
          <br />
          <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
            {product.msrpMinor !== null
              ? `Manufacturer MSRP ${formatMoney(product.msrpMinor, product.currencyCode)} per ${unit}`
              : "Manufacturer MSRP unknown — margin not shown rather than guessed"}
          </span>
        </div>
        <div style={{ marginTop: "1rem" }}>
          {outOfStock ? (
            <p className="field-error">This item is out of stock right now — see substitutes below.</p>
          ) : (
            <AddToDraftButton
              productId={product.id}
              productName={product.name}
              qty={qty}
              onChange={onQtyChange}
            />
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>In this {unit}</h2>
        <ul className="spec-list">
          {unitSpecLines(product).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {product.description && <p style={{ color: "var(--fz-muted)" }}>{product.description}</p>}
      </div>

      {product.requiresImportAcknowledgment && (
        <div className="draft-banner" role="note" style={{ marginTop: "1rem" }}>
          This product is sourced through an import route. You&apos;ll confirm the import notice on the draft
          review screen before submitting.
        </div>
      )}

      {substitutes.length > 0 && (
        <section style={{ marginTop: "1.5rem" }} aria-label="Substitutes">
          <h2 style={{ fontSize: "1.1rem" }}>In stock instead</h2>
          <p style={{ color: "var(--fz-muted)" }}>Same format, closest in price:</p>
          <ul className="substitute-list">
            {substitutes.map((s) => (
              <li key={s.id} className="substitute-row">
                <a href={`/member/catalog/${s.id}`}>
                  <strong>{s.name}</strong>
                  <span className="search-suggestion-unit">
                    {sellableUnitLabel(s.name, s.packsPerUnit)} · {formatMoney(s.priceMinor, s.currencyCode)}
                  </span>
                </a>
                <AddToDraftButton
                  productId={s.id}
                  productName={s.name}
                  qty={qtyById.get(s.id) ?? 0}
                  onChange={onQtyChange}
                  compact
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
