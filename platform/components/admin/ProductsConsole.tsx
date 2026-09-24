"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type Product = {
  id: string;
  sku: string;
  name: string;
  status: string;
  publiclyVisible: boolean;
  priceMinor: number;
  unitsPerCase: number | null;
  costStack?: { markupBps: number; belowMarkupFloor: boolean };
};

/**
 * The live catalog at a glance, and the one place to set case sizes.
 * With "Sell full cases only" on (Settings), a case size makes buyers
 * order in whole cases and pre-fills allocation rounds.
 */
export function ProductsConsole() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/admin/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load products.");
        setProducts((await res.json()).products);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function saveCase(p: Product) {
    const raw = (edits[p.id] ?? "").trim();
    const value = raw === "" ? null : Math.floor(Number(raw));
    if (value !== null && (!Number.isFinite(value) || value < 1)) {
      setMsg((m) => ({ ...m, [p.id]: "Enter a whole number, or leave blank for no case rule." }));
      return;
    }
    const res = await fetch(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitsPerCase: value }),
    });
    if (!res.ok) {
      setMsg((m) => ({ ...m, [p.id]: "Could not save." }));
      return;
    }
    setProducts((list) => list?.map((x) => (x.id === p.id ? { ...x, unitsPerCase: value } : x)) ?? null);
    setEdits((e) => {
      const next = { ...e };
      delete next[p.id];
      return next;
    });
    setMsg((m) => ({ ...m, [p.id]: "Saved." }));
  }

  const shown = (products ?? []).filter(
    (p) => !filter || p.sku.toLowerCase().includes(filter.toLowerCase()) || p.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p className="page-sub">Prices come from price list imports. Set case sizes here.</p>
        </div>
        <a className="btn" href="/admin/catalog-imports">
          Import a price list
        </a>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!products && !error && <p aria-live="polite">Loading…</p>}
      {products && products.length === 0 && (
        <div className="empty-state card">
          <strong>No products yet.</strong>
          Upload a supplier price list under Price list imports, review it, and publish.
        </div>
      )}
      {products && products.length > 0 && (
        <>
          <label htmlFor="product-filter" className="visually-hidden">
            Filter products
          </label>
          <input
            id="product-filter"
            type="search"
            placeholder="Filter by SKU or name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", minHeight: 44, marginBottom: "0.75rem", padding: "0.4rem 0.6rem", border: "1px solid var(--fz-border)", borderRadius: 8 }}
          />
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Price</th>
                <th>Case size</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>
                    {p.name}
                    {p.costStack?.belowMarkupFloor && (
                      <span className="badge badge-bad" style={{ marginLeft: "0.4rem" }}>
                        below markup floor
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${p.status === "active" ? "badge-ok" : "badge-warn"}`}>{p.status}</span>
                    {!p.publiclyVisible && <span className="badge" style={{ marginLeft: "0.3rem" }}>hidden</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{p.priceMinor ? formatMoney(p.priceMinor) : "—"}</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                      <label htmlFor={`case-${p.id}`} className="visually-hidden">
                        Units per case for {p.name}
                      </label>
                      <input
                        id={`case-${p.id}`}
                        className="inline-num"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        placeholder="none"
                        value={edits[p.id] ?? (p.unitsPerCase ?? "").toString()}
                        onChange={(e) => setEdits((x) => ({ ...x, [p.id]: e.target.value }))}
                      />
                      {edits[p.id] !== undefined && (
                        <button type="button" className="btn btn-compact" onClick={() => void saveCase(p)}>
                          Save
                        </button>
                      )}
                      {msg[p.id] && (
                        <span role="status" style={{ fontSize: "0.8rem", color: "var(--fz-muted)" }}>
                          {msg[p.id]}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
