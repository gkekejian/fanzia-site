"use client";

import { useEffect, useState, type FormEvent } from "react";

type Supplier = { id: string; name: string };
type PoPackRow = {
  id: string;
  roundId: string;
  roundRef: string;
  supplierId: string;
  status: "generated" | "ordered";
  confirmationNumbers: string[] | null;
  orderedAt: string | null;
  createdAt: string;
  payload: {
    items: { distributorSku: string; qtyCases: number; qtyUnits: number; memo: string | null; mappingWarning: boolean; productName: string }[];
    warnings: string[];
    totals: { qtyCases: number; qtyUnits: number };
  };
};

const DEFAULT_LINES = JSON.stringify(
  [
    {
      productId: "PRODUCT_UUID",
      platformSku: "FZ-JP-ABYSS",
      productName: "Abyss Eye Booster Box (JP)",
      qtyCases: 6,
      qtyUnits: 216,
      internalQtyUnits: 48,
      customerQtyUnits: 168,
    },
  ],
  null,
  2,
);

export function PoPacksConsole() {
  const [packs, setPacks] = useState<PoPackRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Generate form state
  const [roundId, setRoundId] = useState("");
  const [roundRef, setRoundRef] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [overrideSupplierId, setOverrideSupplierId] = useState("");
  const [linesJson, setLinesJson] = useState(DEFAULT_LINES);

  // Mark-ordered state, keyed by round id
  const [confirmInputs, setConfirmInputs] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch("/api/admin/po-packs");
    if (res.ok) {
      const body = await res.json();
      setPacks(body.poPacks);
      setSuppliers(body.suppliers);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onGenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let lines: unknown;
    try {
      lines = JSON.parse(linesJson);
    } catch {
      setError("Line items must be valid JSON.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/po-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId,
        roundRef,
        supplierId,
        lines,
        overrideSupplierId: overrideSupplierId || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not generate PO pack.");
      return;
    }
    setRoundId("");
    setRoundRef("");
    setLinesJson(DEFAULT_LINES);
    setOverrideSupplierId("");
    load();
  }

  async function onMarkOrdered(pack: PoPackRow) {
    const confirmationNumbers = (confirmInputs[pack.roundId] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (confirmationNumbers.length === 0) {
      setError("Enter at least one distributor confirmation number first.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/allocation-rounds/${encodeURIComponent(pack.roundId)}/mark-ordered`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationNumbers, supplierId: pack.supplierId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not mark round ordered.");
      return;
    }
    load();
  }

  return (
    <div>
      <section>
        <h2>Generate PO pack</h2>
        <form onSubmit={onGenerate}>
          <label>
            Round ID
            <input value={roundId} onChange={(e) => setRoundId(e.target.value)} placeholder="e.g. round-2026-10-kp" required />
          </label>
          <label>
            Round reference
            <input value={roundRef} onChange={(e) => setRoundRef(e.target.value)} placeholder="e.g. King Punch October order" required />
          </label>
          <label>
            Supplier
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Override supplier (optional — audit-logged)
            <select value={overrideSupplierId} onChange={(e) => setOverrideSupplierId(e.target.value)}>
              <option value="">Use round supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Line items (JSON — from the closed allocation round review)
            <textarea value={linesJson} onChange={(e) => setLinesJson(e.target.value)} rows={10} spellCheck={false} />
          </label>
          <button type="submit" className="btn" disabled={busy || !supplierId}>
            {busy ? "Generating…" : "Generate pack"}
          </button>
        </form>
      </section>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <section>
        <h2>Generated packs</h2>
        {packs === null && <p className="muted">Loading…</p>}
        {packs !== null && packs.length === 0 && <p className="muted">No PO packs generated yet.</p>}
        {packs?.map((pack) => (
          <article key={pack.id} className="card">
            <h3>
              {pack.roundRef} — {pack.status === "ordered" ? "ordered" : "draft pack"}
            </h3>
            <p className="muted">
              Round {pack.roundId} · {pack.payload.items.length} lines · {pack.payload.totals.qtyCases} cases /{" "}
              {pack.payload.totals.qtyUnits} units · generated {new Date(pack.createdAt).toLocaleString()}
            </p>
            {pack.payload.warnings.length > 0 && (
              <ul className="warnings">
                {pack.payload.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <p>
              <a className="btn btn-secondary" href={`/api/admin/po-packs/${pack.id}/download?format=csv`}>
                Download CSV
              </a>{" "}
              <a className="btn btn-secondary" href={`/api/admin/po-packs/${pack.id}/download?format=html`}>
                Download printable HTML
              </a>
            </p>
            {pack.status === "ordered" ? (
              <p className="muted">
                Ordered {pack.orderedAt ? new Date(pack.orderedAt).toLocaleString() : ""} — confirmation:{" "}
                {(pack.confirmationNumbers ?? []).join(", ")}
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onMarkOrdered(pack);
                }}
              >
                <label>
                  Distributor confirmation number(s) — order is placed by hand, never by this app
                  <input
                    value={confirmInputs[pack.roundId] ?? ""}
                    onChange={(e) => setConfirmInputs({ ...confirmInputs, [pack.roundId]: e.target.value })}
                    placeholder="e.g. KP-88421 (comma-separate multiples)"
                  />
                </label>
                <button type="submit" className="btn" disabled={busy}>
                  Mark round ordered
                </button>
              </form>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
