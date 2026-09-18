"use client";

import { useState } from "react";
import { EMPTY_FILTER, languageOptions, type ProductFilter, type ShoppingProduct } from "@/lib/member/shopping";

/**
 * Compact filter sheet (mobile bottom sheet / desktop inline panel).
 * Facets map to real product fields only — no dead-end brand/set taxonomies
 * on a small catalog.
 */
export function FilterSheet({
  products,
  filter,
  onChange,
  boughtBeforeCount,
}: {
  products: ShoppingProduct[];
  filter: ProductFilter;
  onChange: (f: ProductFilter) => void;
  boughtBeforeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const languages = languageOptions(products);

  const activeCount =
    (filter.type ? 1 : 0) +
    (filter.language ? 1 : 0) +
    (filter.availability ? 1 : 0) +
    (filter.priceBand ? 1 : 0) +
    (filter.boughtBefore ? 1 : 0) +
    (filter.inStockOnly ? 1 : 0);

  const clear = () => onChange({ ...EMPTY_FILTER });

  const body = (
    <div className="filter-grid">
      <div className="filter-field">
        <label htmlFor="filter-type">Product type</label>
        <select
          id="filter-type"
          value={filter.type}
          onChange={(e) => onChange({ ...filter, type: e.target.value as ProductFilter["type"] })}
        >
          <option value="">All types</option>
          <option value="Booster Box">Booster Box</option>
          <option value="Case">Case</option>
          <option value="Elite Trainer Box">Elite Trainer Box</option>
          <option value="Bundle">Bundle</option>
          <option value="Tin">Tin</option>
          <option value="Booster Pack">Booster Pack</option>
          <option value="Box">Box</option>
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-language">Language</label>
        <select
          id="filter-language"
          value={filter.language}
          onChange={(e) => onChange({ ...filter, language: e.target.value })}
        >
          <option value="">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-availability">Availability</label>
        <select
          id="filter-availability"
          value={filter.availability}
          onChange={(e) => onChange({ ...filter, availability: e.target.value as ProductFilter["availability"] })}
        >
          <option value="">Any</option>
          <option value="in">In stock</option>
          <option value="low">Only a few left</option>
          <option value="preorder">Preorder</option>
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-price">Price band</label>
        <select
          id="filter-price"
          value={filter.priceBand}
          onChange={(e) => onChange({ ...filter, priceBand: e.target.value as ProductFilter["priceBand"] })}
        >
          <option value="">Any price</option>
          <option value="under100">Under $100 / unit</option>
          <option value="100to250">$100–$250 / unit</option>
          <option value="over250">Over $250 / unit</option>
        </select>
      </div>
      <div className="filter-chips">
        <button
          type="button"
          className={`chip-toggle ${filter.boughtBefore ? "chip-toggle-on" : ""}`}
          aria-pressed={filter.boughtBefore}
          onClick={() => onChange({ ...filter, boughtBefore: !filter.boughtBefore })}
          disabled={boughtBeforeCount === 0}
          title={boughtBeforeCount === 0 ? "You haven't bought anything yet" : "Show products you've bought before"}
        >
          Bought before
        </button>
        <button
          type="button"
          className={`chip-toggle ${filter.inStockOnly ? "chip-toggle-on" : ""}`}
          aria-pressed={filter.inStockOnly}
          onClick={() => onChange({ ...filter, inStockOnly: !filter.inStockOnly })}
        >
          In stock only
        </button>
      </div>
      <div className="filter-actions">
        <button type="button" className="btn btn-secondary" onClick={clear} disabled={activeCount === 0}>
          Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        <button type="button" className="btn filter-done" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </div>
  );

  return (
    <div className="filter-sheet-wrap">
      <button
        type="button"
        className="btn btn-secondary filter-open-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="filter-sheet"
      >
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
      {open && (
        <>
          <div className="filter-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="filter-sheet" className="filter-sheet" role="dialog" aria-label="Catalog filters">
            {body}
          </div>
        </>
      )}
      <div className="filter-inline">{body}</div>
    </div>
  );
}
