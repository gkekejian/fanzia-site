"use client";

import { useEffect, useRef, useState } from "react";
import { searchSuggestions, type ShoppingProduct } from "@/lib/member/shopping";
import { AddToDraftButton } from "./AddToDraftButton";

/**
 * Sharp search (set names, set codes — "ME2.5", "Prismatic") with
 * autocomplete, plus a "Quick add" bar pinned under it: type a set
 * name/code → inline results with box-steppers, no page change. Power
 * buyers restock their usual SKUs in under a minute on a phone.
 */
export function SearchAndQuickAdd({
  products,
  query,
  onQueryChange,
  qtyById,
  onQtyChange,
}: {
  products: ShoppingProduct[];
  query: string;
  onQueryChange: (q: string) => void;
  qtyById: Map<string, number>;
  onQtyChange: (productId: string, qty: number) => void;
}) {
  const [quick, setQuick] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const suggestions = searchSuggestions(query, products);
  const quickResults = searchSuggestions(quick, products, 5);

  useEffect(() => setHighlight(-1), [query]);

  function pickSuggestion(id: string, name: string) {
    onQueryChange(name);
    setSuggestOpen(false);
    setHighlight(-1);
    searchRef.current?.blur();
  }

  return (
    <div className="search-block">
      <div className="search-wrap" role="search">
        <label htmlFor="catalog-search" className="visually-hidden">
          Search the catalog
        </label>
        <input
          id="catalog-search"
          ref={searchRef}
          type="search"
          autoComplete="off"
          placeholder="Search sets, set codes, languages…"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && suggestions.length) {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && suggestions.length) {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter" && highlight >= 0 && suggestions[highlight]) {
              pickSuggestion(suggestions[highlight]!.id, suggestions[highlight]!.name);
            } else if (e.key === "Escape") {
              setSuggestOpen(false);
            }
          }}
          aria-expanded={suggestOpen && suggestions.length > 0}
          aria-controls="catalog-search-suggestions"
          role="combobox"
          aria-autocomplete="list"
        />
        {suggestOpen && suggestions.length > 0 && (
          <ul id="catalog-search-suggestions" className="search-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === highlight} className={i === highlight ? "active" : ""}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(s.id, s.name);
                  }}
                >
                  <strong>{s.name}</strong>
                  <span className="search-suggestion-unit">{s.unitLine}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="quick-add">
        <label htmlFor="quick-add-input" className="quick-add-label">
          Quick add
        </label>
        <input
          id="quick-add-input"
          type="text"
          autoComplete="off"
          placeholder="Type a set name or code, add boxes inline…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          aria-describedby="quick-add-help"
        />
        <span id="quick-add-help" className="visually-hidden">
          Matching products appear below with quantity steppers.
        </span>
        {quick.trim() !== "" && (
          <ul className="quick-add-results">
            {quickResults.length === 0 && (
              <li className="quick-add-empty">No matches — check the set code spelling.</li>
            )}
            {quickResults.map((r) => {
              const p = products.find((x) => x.id === r.id)!;
              return (
                <li key={r.id} className="quick-add-row">
                  <span className="quick-add-name">
                    <strong>{r.name}</strong>
                    <span className="search-suggestion-unit">{r.unitLine}</span>
                  </span>
                  <AddToDraftButton
                    productId={r.id}
                    productName={p.name}
                    qty={qtyById.get(r.id) ?? 0}
                    onChange={onQtyChange}
                    compact
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
