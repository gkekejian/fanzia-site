"use client";

import { useEffect, useMemo, useState } from "react";
import { COMMERCIAL_DISCLOSURE_SHORT } from "@/lib/disclaimers";
import {
  applyFilter,
  draftSummaryNames,
  EMPTY_FILTER,
  searchMatches,
  type ProductFilter,
  type ShoppingProduct,
} from "@/lib/member/shopping";
import { useDraft } from "./useDraft";
import { ProductCard } from "./ProductCard";
import { StickyDraftBar } from "./StickyDraftBar";
import { SearchAndQuickAdd } from "./SearchAndQuickAdd";
import { CuratedRows } from "./CuratedRows";
import { FilterSheet } from "./FilterSheet";

/** Trending products first (by rank), then everything else in catalog order. */
function sortTrendingFirst(products: ShoppingProduct[]): ShoppingProduct[] {
  return [...products].sort((a, b) => {
    const ra = a.trendingRank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.trendingRank ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

export function MemberCatalog() {
  const [products, setProducts] = useState<ShoppingProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>({ ...EMPTY_FILTER });
  const [boughtBeforeIds, setBoughtBeforeIds] = useState<Set<string>>(new Set());
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [disclosureDismissed, setDisclosureDismissed] = useState(false);

  const { lines, qtyById, setQty, saveError } = useDraft();

  useEffect(() => {
    try {
      if (sessionStorage.getItem("fz-commercial-disclosure-dismissed") === "1") setDisclosureDismissed(true);
      if (sessionStorage.getItem("fz-resume-dismissed") === "1") setResumeDismissed(true);
    } catch {
      // storage unavailable — banners simply show again next load
    }
  }, []);

  useEffect(() => {
    fetch("/api/member/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load the catalog.");
        const body = await res.json();
        setProducts(body.products);
      })
      .catch((err) => setError(err.message));
    fetch("/api/member/purchased-products")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setBoughtBeforeIds(new Set(body.productIds ?? []));
      })
      .catch(() => {});
  }, []);

  const visible = useMemo(() => {
    if (!products) return null;
    const searched = query.trim() ? products.filter((p) => searchMatches(query, p)) : products;
    return sortTrendingFirst(applyFilter(searched, filter, boughtBeforeIds));
  }, [products, query, filter, boughtBeforeIds]);

  const browsing = query.trim() !== "" || Object.values(filter).some(Boolean);
  const savedLines = lines ?? [];
  const nameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const priceById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, { priceMinor: p.priceMinor }])),
    [products],
  );

  return (
    <main className="container catalog-page" style={{ maxWidth: "1100px" }}>
      <h1>Catalog</h1>

      {savedLines.length > 0 && !resumeDismissed && (
        <div className="draft-banner resume-banner" role="status">
          <span>
            <strong>Resume your draft</strong> — {draftSummaryNames(savedLines, nameById)}{" "}
            <a href="/member/draft-request">Continue →</a>
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "0.3rem 0.8rem", flexShrink: 0 }}
            aria-label="Dismiss resume draft banner"
            onClick={() => {
              setResumeDismissed(true);
              try {
                sessionStorage.setItem("fz-resume-dismissed", "1");
              } catch {
                // storage unavailable — banner simply shows again next load
              }
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <p className="fee-strip">
        Wholesale orders have a <strong>$500 minimum</strong>. Orders under <strong>$750</strong> include a{" "}
        <strong>$25 small-order fee</strong> — shown on every screen before you submit, never first at invoice.
      </p>

      {!disclosureDismissed && (
        <div className="draft-banner" role="note" style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", fontWeight: 400 }}>
          <span style={{ flex: 1 }}>{COMMERCIAL_DISCLOSURE_SHORT}</span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "0.3rem 0.8rem", flexShrink: 0 }}
            aria-label="Dismiss ordering terms notice"
            onClick={() => {
              setDisclosureDismissed(true);
              try {
                sessionStorage.setItem("fz-commercial-disclosure-dismissed", "1");
              } catch {
                // storage unavailable — nothing to persist
              }
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {products && (
        <SearchAndQuickAdd
          products={products}
          query={query}
          onQueryChange={setQuery}
          qtyById={qtyById}
          onQtyChange={setQty}
        />
      )}

      {products && (
        <FilterSheet
          products={products}
          filter={filter}
          onChange={setFilter}
          boughtBeforeCount={boughtBeforeIds.size}
        />
      )}

      {saveError && (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!products && !error && <p aria-live="polite">Loading…</p>}

      {products && !browsing && (
        <CuratedRows products={products} qtyById={qtyById} onQtyChange={setQty} />
      )}

      {visible && (
        <>
          {browsing && (
            <h2 className="catalog-section-title">
              {visible.length === 0 ? "No matches" : `${visible.length} result${visible.length === 1 ? "" : "s"}`}
              {query.trim() && (
                <>
                  {" "}
                  for “{query.trim()}”{" "}
                  <button type="button" className="link-btn" onClick={() => setQuery("")}>
                    clear
                  </button>
                </>
              )}
            </h2>
          )}
          {!browsing && <h2 className="catalog-section-title">All products</h2>}
          {visible.length === 0 && (
            <p>
              Nothing matches — try a different set code or clear the filters.{" "}
              <button type="button" className="link-btn" onClick={() => { setQuery(""); setFilter({ ...EMPTY_FILTER }); }}>
                Reset catalog
              </button>
            </p>
          )}
          {visible.length > 0 && (
            <div className="product-grid">
              {visible.map((p) => (
                <ProductCard key={p.id} product={p} qty={qtyById.get(p.id) ?? 0} onQtyChange={setQty} />
              ))}
            </div>
          )}
        </>
      )}

      <StickyDraftBar lines={savedLines} priceById={priceById} />
    </main>
  );
}
