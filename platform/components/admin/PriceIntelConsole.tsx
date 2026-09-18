"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Owner-only price-intelligence console (W5). Every number on this page
 * is cost-stack data — supplier identity, supplier prices, landed costs,
 * margins — and must never reach a buyer surface. This component only
 * renders under /admin (requireOwnerPageUser) and reads from
 * /api/admin/price-intel, which enforces the cost_stack:read boundary.
 */

type SupplierRow = {
  supplierId: string;
  supplierName: string;
  unitPriceMinor: number;
  currencyCode: string;
  moq: number | null;
  caseSize: number | null;
  validFrom: string | null;
  landedCostMinor: number | null;
  landedError: string | null;
  priceChangePct: number | null;
  history: { unitPriceMinor: number; currencyCode: string; validFrom: string | null }[];
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  isReal: "estimated" | "real";
  wholesalePriceMinor: number | null;
  market: {
    marketPriceMinor: number;
    source: string;
    observedAt: string | null;
    sampleSize: number | null;
    confidence: "high" | "low";
    sourceUrl: string | null;
  } | null;
  suppliers: SupplierRow[];
  cheapest: { supplierId: string; landedCostMinor: number } | null;
  marginVsWholesaleBps: number | null;
  marginVsMarketBps: number | null;
  buyOpportunity: boolean;
};

type Dataset = {
  products: ProductRow[];
  suppliers: { id: string; name: string }[];
  fxRates: Record<string, number>;
  marginFloorBps: number;
  priceChangeAlerts: { sku: string; supplierName: string; priceChangePct: number | null; validFrom: string | null }[];
  marginFloorBreaches: { sku: string; marginVsWholesaleBps: number | null }[];
  lowConfidenceMarkets: { sku: string; sampleSize: number | null }[];
  ebayConfigured: boolean;
};

function fmtUsd(minor: number | null): string {
  if (minor === null) return "—";
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMinor(minor: number | null, currency: string): string {
  if (minor === null) return "—";
  if (currency === "JPY") return `¥${minor.toLocaleString("en-US")}`;
  return fmtUsd(minor);
}

function fmtBps(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

function bannerStyle(kind: "red" | "amber" | "blue"): React.CSSProperties {
  const bg = kind === "red" ? "#fde8e8" : kind === "amber" ? "#fef3d8" : "#e8f1fd";
  const border = kind === "red" ? "#e89b9b" : kind === "amber" ? "#e8c96b" : "#9bc0e8";
  return { background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: "10px 14px", marginBottom: 12 };
}

export function PriceIntelConsole() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/price-intel");
    if (!res.ok) {
      setError("Could not load price-intelligence data.");
      return;
    }
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function postJson(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setFormError(null);
    setFormOk(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(payload.error ?? "Request failed.");
      return;
    }
    if (payload.queued) {
      setFormOk(`Queued as agent proposal ${payload.proposalId} — awaiting owner approval.`);
    } else {
      setFormOk("Applied.");
    }
    load();
  }

  async function uploadCsv(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFormError("Choose a CSV file.");
      return;
    }
    setBusy(true);
    setFormError(null);
    setFormOk(null);
    const res = await fetch("/api/admin/price-intel/upload", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(payload.error ?? "Upload failed.");
      return;
    }
    setFormOk(
      payload.queued
        ? `Upload queued as proposal ${payload.proposalId} — awaiting owner approval.`
        : `Upload applied: ${payload.rowCount} rows.`,
    );
    load();
  }

  async function markReal(productId: string) {
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/admin/price-intel/market", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(payload.error ?? "Could not mark pricing as real.");
      return;
    }
    setFormOk(
      payload.queued
        ? `Queued as proposal ${payload.proposalId} — awaiting owner approval.`
        : "Pricing marked as real (audited).",
    );
    load();
  }

  if (error) return <main className="container"><p className="field-error" role="alert">{error}</p></main>;
  if (!data) return <main className="container"><p>Loading price intelligence…</p></main>;

  return (
    <main className="container" style={{ maxWidth: "1200px" }}>
      <h1>Price intelligence</h1>
      <p>
        Supplier prices, landed costs, and market signals — owner-only. Landed costs below are per-unit at
        reference quantity 1 (flat order fees fully allocated). Nothing here reaches buyers.
      </p>

      {data.priceChangeAlerts.length > 0 && (
        <div style={bannerStyle("red")} role="alert">
          <strong>Supplier price changes &gt;10%:</strong>
          <ul>
            {data.priceChangeAlerts.map((a, i) => (
              <li key={i}>
                {a.sku} — {a.supplierName}: {a.priceChangePct !== null ? a.priceChangePct.toFixed(1) : "?"}%
                {a.validFrom ? ` (effective ${a.validFrom.slice(0, 10)})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.marginFloorBreaches.length > 0 && (
        <div style={bannerStyle("amber")} role="alert">
          <strong>Below margin floor ({fmtBps(data.marginFloorBps)}):</strong>
          <ul>
            {data.marginFloorBreaches.map((b, i) => (
              <li key={i}>
                {b.sku}: wholesale margin {fmtBps(b.marginVsWholesaleBps)} on cheapest landed cost
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.lowConfidenceMarkets.length > 0 && (
        <div style={bannerStyle("amber")} role="alert">
          <strong>Market prices needing owner review (low confidence):</strong>
          <ul>
            {data.lowConfidenceMarkets.map((m, i) => (
              <li key={i}>
                {m.sku} (sample {m.sampleSize ?? "?"}) — verify before relying on it
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data.ebayConfigured && (
        <div style={bannerStyle("blue")}>
          eBay sold data is not available on the free tier (Marketplace Insights scope not granted) — market
          prices are entered manually below. See lib/priceIntel/ebay.ts for the research.
        </div>
      )}

      {formError && <p className="field-error" role="alert">{formError}</p>}
      {formOk && <p style={{ color: "green" }}>{formOk}</p>}

      {data.products.map((p) => (
        <section key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 14, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              {p.sku} — {p.name}
            </h2>
            <div>
              {p.buyOpportunity && (
                <span style={{ background: "#d4f0d4", border: "1px solid #5cb85c", borderRadius: 4, padding: "2px 8px", marginRight: 8 }}>
                  BUY OPPORTUNITY
                </span>
              )}
              <span
                style={{
                  background: p.isReal === "real" ? "#d4f0d4" : "#fde8e8",
                  borderRadius: 4,
                  padding: "2px 8px",
                  marginRight: 8,
                }}
              >
                {p.isReal === "real" ? "PRICING: REAL" : "PRICING: ESTIMATED"}
              </span>
              {p.isReal !== "real" && (
                <button type="button" disabled={busy} onClick={() => markReal(p.id)}>
                  Mark pricing real
                </button>
              )}
            </div>
          </div>
          <p style={{ margin: "6px 0" }}>
            Platform wholesale price: <strong>{fmtUsd(p.wholesalePriceMinor)}</strong>
            {" · "}Market: <strong>{p.market ? fmtUsd(p.market.marketPriceMinor) : "—"}</strong>
            {p.market && ` (${p.market.source}, ${p.market.confidence} confidence, n=${p.market.sampleSize ?? "?"})`}
            {p.market?.sourceUrl && (
              <>
                {" · "}<a href={p.market.sourceUrl} target="_blank" rel="noreferrer">source</a>
              </>
            )}
          </p>
          {p.suppliers.length === 0 ? (
            <p>No supplier prices on file.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #999" }}>
                  <th>Supplier</th>
                  <th>Unit price</th>
                  <th>Landed / unit</th>
                  <th>Margin vs wholesale</th>
                  <th>Margin vs market</th>
                  <th>Price change</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {p.suppliers.map((s) => {
                  const isCheapest = p.cheapest?.supplierId === s.supplierId;
                  return (
                    <tr
                      key={s.supplierId}
                      style={{
                        borderBottom: "1px solid #eee",
                        background: isCheapest ? "#f4faf4" : undefined,
                        fontWeight: isCheapest ? 700 : undefined,
                      }}
                    >
                      <td>
                        {s.supplierName}
                        {isCheapest && " ★ best landed"}
                      </td>
                      <td>
                        {fmtMinor(s.unitPriceMinor, s.currencyCode)}
                        <div style={{ fontSize: 12, color: "#666" }}>
                          {s.moq ? `MOQ ${s.moq}` : ""}{s.moq && s.caseSize ? " · " : ""}{s.caseSize ? `case ${s.caseSize}` : ""}
                        </div>
                      </td>
                      <td>
                        {s.landedCostMinor !== null ? fmtUsd(s.landedCostMinor) : `— (${s.landedError ?? "unpriced"})`}
                      </td>
                      <td>{isCheapest ? fmtBps(p.marginVsWholesaleBps) : "—"}</td>
                      <td>{isCheapest ? fmtBps(p.marginVsMarketBps) : "—"}</td>
                      <td>
                        {s.priceChangePct === null
                          ? "—"
                          : `${s.priceChangePct > 0 ? "+" : ""}${s.priceChangePct.toFixed(1)}%`}
                      </td>
                      <td>
                        <details>
                          <summary>view</summary>
                          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                            {s.history.map((h, i) => (
                              <li key={i}>
                                {fmtMinor(h.unitPriceMinor, h.currencyCode)}
                                {h.validFrom ? ` — ${h.validFrom.slice(0, 10)}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <section style={{ marginTop: 30 }}>
        <h2>Upload supplier price list</h2>
        <form onSubmit={uploadCsv}>
          <p>
            <label>
              Supplier:{" "}
              <select name="supplierId" required>
                <option value="">— choose —</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              CSV file: <input type="file" name="file" accept=".csv,text/csv" />
            </label>
          </p>
          <p>
            <label>
              Notes: <input type="text" name="notes" style={{ width: 300 }} />
            </label>
          </p>
          <p>
            <button type="submit" disabled={busy}>Upload price list</button>
          </p>
          <p style={{ fontSize: 13, color: "#555" }}>
            Columns: sku, unit_price, currency, moq, case_size, shipping_terms, valid_from, notes.
            unit_price in MAJOR units (1500 JPY, 145.00 USD). sku must match a product exactly.
          </p>
        </form>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Set FX rate</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            postJson("/api/admin/price-intel/fx", {
              fromCurrency: String(f.get("from")),
              toCurrency: String(f.get("to")),
              rate: Number(f.get("rate")),
            });
          }}
        >
          <input name="from" placeholder="JPY" required style={{ width: 70 }} /> →{" "}
          <input name="to" placeholder="USD" required style={{ width: 70 }} /> ={" "}
          <input name="rate" placeholder="0.0066" required style={{ width: 110 }} type="number" step="any" />{" "}
          <button type="submit" disabled={busy}>Set rate</button>
        </form>
        <p style={{ fontSize: 13, color: "#555" }}>
          Current USD rates: {Object.entries(data.fxRates).map(([c, r]) => `${c}→USD ${r}`).join(", ") || "none set"}
        </p>
      </section>

      <section style={{ marginTop: 24, marginBottom: 40 }}>
        <h2>Enter market price manually</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const productId = String(f.get("productId"));
            const dollars = Number(f.get("dollars"));
            postJson("/api/admin/price-intel/market", {
              productId,
              marketPriceMinor: Math.round(dollars * 100),
              sourceUrl: String(f.get("sourceUrl")),
              notes: String(f.get("notes") ?? ""),
            });
          }}
        >
          <p>
            <label>
              Product:{" "}
              <select name="productId" required>
                <option value="">— choose —</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Market price (USD): <input name="dollars" type="number" step="0.01" required style={{ width: 120 }} />
            </label>
          </p>
          <p>
            <label>
              Source URL (required): <input name="sourceUrl" type="url" required style={{ width: 340 }} />
            </label>
          </p>
          <p>
            <label>
              Notes: <input name="notes" style={{ width: 340 }} />
            </label>
          </p>
          <button type="submit" disabled={busy}>Save market price</button>
        </form>
      </section>
    </main>
  );
}
