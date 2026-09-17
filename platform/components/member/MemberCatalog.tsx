"use client";

import { useEffect, useState } from "react";

type MemberProduct = {
  id: string;
  sku: string;
  name: string;
  editionLanguage: string;
  origin: string;
  condition: string;
  packsPerUnit: number;
  cardsPerPack: number | null;
  releaseStatus: string;
  description: string;
  priceMinor: number;
  currencyCode: string;
  availability: { checkedAt: string; confidence: string; statusLabel: string; stale: boolean } | null;
};

// Client-side display only — the currency table is the source of truth
// server-side (db/schema/currency.ts). Seeded currencies only.
const EXPONENT: Record<string, number> = { USD: 2, JPY: 0 };

function formatPrice(minor: number, currencyCode: string): string {
  const exponent = EXPONENT[currencyCode] ?? 2;
  const amount = minor / 10 ** exponent;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode || "USD" }).format(amount);
}

export function MemberCatalog() {
  const [products, setProducts] = useState<MemberProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [savedProductId, setSavedProductId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/member/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load the catalog.");
        const body = await res.json();
        setProducts(body.products);
      })
      .catch((err) => setError(err.message));

    fetch("/api/member/draft-request")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        const initial: Record<string, number> = {};
        for (const line of body.draft?.lines ?? []) {
          initial[line.productId] = line.qtyRequested;
        }
        setQty(initial);
      })
      .catch(() => {});
  }, []);

  async function addToDraft(productId: string) {
    const requested = qty[productId] ?? 0;
    if (requested <= 0) return;

    const draftRes = await fetch("/api/member/draft-request");
    const draftBody = draftRes.ok ? await draftRes.json() : { draft: { lines: [], notes: "" } };
    const existingLines: { productId: string; qtyRequested: number }[] = draftBody.draft?.lines ?? [];
    const withoutThis = existingLines.filter((l) => l.productId !== productId);
    const nextLines = [...withoutThis, { productId, qtyRequested: requested }];

    const res = await fetch("/api/member/draft-request", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: nextLines, notes: draftBody.draft?.notes ?? "" }),
    });
    if (res.ok) {
      setSavedProductId(productId);
      setTimeout(() => setSavedProductId((cur) => (cur === productId ? null : cur)), 2000);
    }
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Member catalog</h1>
      <p>
        Prices shown are wholesale item prices. Outbound shipping and applicable sales tax are calculated separately
        at request time — this is not a delivered price.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!products && !error && <p aria-live="polite">Loading…</p>}
      {products && products.length === 0 && <p>No priced products are available yet.</p>}
      {products && products.length > 0 && (
        <table>
          <caption className="visually-hidden">Member catalog with wholesale pricing and availability</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Price</th>
              <th scope="col">Availability</th>
              <th scope="col">Qty</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <br />
                  <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
                    {p.sku} · {p.editionLanguage} · {p.condition === "sealed" ? "Sealed" : "No shrink"}
                  </span>
                </td>
                <td>{formatPrice(p.priceMinor, p.currencyCode)}</td>
                <td>
                  {p.availability ? (
                    <span title={p.availability.confidence}>
                      {p.availability.statusLabel}
                      {p.availability.stale ? " (needs refresh)" : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--fz-muted)" }}>Not yet checked</span>
                  )}
                </td>
                <td style={{ width: "5.5rem" }}>
                  <label htmlFor={`qty-${p.id}`} className="visually-hidden">
                    Quantity for {p.name}
                  </label>
                  <input
                    id={`qty-${p.id}`}
                    type="number"
                    min={0}
                    value={qty[p.id] ?? ""}
                    onChange={(e) => setQty((cur) => ({ ...cur, [p.id]: Number(e.target.value) }))}
                  />
                </td>
                <td>
                  <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem" }} onClick={() => addToDraft(p.id)}>
                    {savedProductId === p.id ? "Saved ✓" : "Save to draft"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: "1.5rem" }}>
        <a href="/member/draft-request">Review your draft request →</a>
      </p>
    </main>
  );
}
