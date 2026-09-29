"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { sellableUnitLabel, type ShoppingProduct } from "@/lib/member/shopping";
import { useDraft } from "./useDraft";
import { useOrderRules } from "./OrderRulesContext";
import { AddToDraftButton } from "./AddToDraftButton";

/** The buyer's wants list: what they'd take from the next drop. Not an order. */
export function MemberWants() {
  const { allocationMode } = useOrderRules();
  const { lines, setQty, saveError } = useDraft();
  const [products, setProducts] = useState<ShoppingProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/member/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setProducts((await res.json()).products);
      })
      .catch(() => setError("Could not load the catalog."));
  }, []);

  if (!allocationMode) {
    return (
      <main className="container" style={{ maxWidth: "820px" }}>
        <h1>My wants</h1>
        <p>
          Fanzia is taking orders directly right now. Build a <a href="/member/draft-request">draft request</a> instead.
        </p>
      </main>
    );
  }

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const rows = (lines ?? []).filter((l) => l.qtyRequested > 0);

  return (
    <main className="container" style={{ maxWidth: "820px" }}>
      <h1>My wants</h1>
      <p style={{ marginTop: 0 }}>
        What you&apos;d take from the next drop. It isn&apos;t an order and costs nothing. When stock lands we offer it
        to buyers based on these lists and their history with us, and email you if you get an offer.
      </p>
      {(error || saveError) && (
        <p className="field-error" role="alert">
          {error ?? saveError}
        </p>
      )}
      {(!lines || !products) && !error && <p aria-live="polite">Loading…</p>}
      {lines && products && rows.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            Nothing on your list yet. Browse the <a href="/member/catalog">catalog</a> and tap <em>I want this</em>.
          </p>
        </div>
      )}
      {lines && products && rows.length > 0 && (
        <table>
          <caption className="visually-hidden">Products you want</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Current price</th>
              <th scope="col">How many</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const p = byId.get(l.productId);
              return (
                <tr key={l.productId}>
                  <td data-label="Product">
                    {p ? (
                      <>
                        <a href={`/member/catalog/${p.id}`}>{p.name}</a>
                        <div style={{ fontSize: "0.85em", color: "var(--fz-muted)" }}>
                          {sellableUnitLabel(p.name, p.packsPerUnit, p.sellUnit)}
                        </div>
                      </>
                    ) : (
                      <>
                        No longer listed{" "}
                        <button type="button" className="link-btn" onClick={() => setQty(l.productId, 0)}>
                          remove
                        </button>
                      </>
                    )}
                  </td>
                  <td data-label="Current price">{p ? formatMoney(p.priceMinor, p.currencyCode) : "—"}</td>
                  <td data-label="How many">
                    {p && (
                      <AddToDraftButton
                        productId={p.id}
                        productName={p.name}
                        qty={l.qtyRequested}
                        onChange={setQty}
                        unitsPerCase={p.unitsPerCase}
                        compact
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p style={{ color: "var(--fz-muted)", marginTop: "1rem" }}>
        Offer prices can differ from today&apos;s catalog price; the offer shows the exact total before you pay.
      </p>
    </main>
  );
}
