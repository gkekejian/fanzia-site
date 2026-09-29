"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/format";
import type { DropListRow } from "@/lib/offers/drops";

const STATUS_BADGE: Record<string, string> = { draft: "badge-warn", live: "badge-ok", closed: "badge", cancelled: "badge" };

/** Owner: every allocation drop, plus "New drop". */
export function DropsList() {
  const [drops, setDrops] = useState<DropListRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/drops")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setDrops((await res.json()).drops);
      })
      .catch(() => setError("Could not load drops."));
    fetch("/api/admin/suppliers")
      .then(async (res) => (res.ok ? setSuppliers((await res.json()).suppliers ?? []) : null))
      .catch(() => {});
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/drops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, supplierId: supplierId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the drop.");
      window.location.href = `/admin/drops/${body.drop.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the drop.");
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <div className="page-head">
        <div>
          <h1>Drops</h1>
          <p className="page-sub">
            Offer incoming stock to buyers. Add products and quantities, review the suggested split, then send. Buyers
            get 48 hours to Accept &amp; pay; anything declined or unanswered goes to the next buyer automatically.
          </p>
        </div>
      </div>

      <form onSubmit={create} className="card" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1rem" }}>
        <label style={{ flex: "2 1 240px" }}>
          New drop name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prismatic Evolutions, Nov" maxLength={200} required />
        </label>
        <label style={{ flex: "1 1 200px" }}>
          Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not set yet</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create drop"}
        </button>
      </form>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!drops && !error && <p aria-live="polite">Loading…</p>}
      {drops && drops.length === 0 && <p>No drops yet.</p>}
      {drops && drops.length > 0 && (
        <table>
          <caption className="visually-hidden">Drops, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Drop</th>
              <th scope="col">Status</th>
              <th scope="col">Products</th>
              <th scope="col">Open offers</th>
              <th scope="col">Paid</th>
              <th scope="col">Sent</th>
            </tr>
          </thead>
          <tbody>
            {drops.map((d) => (
              <tr key={d.id}>
                <td>
                  <a href={`/admin/drops/${d.id}`}>{d.name}</a>
                  {d.supplierName && <div style={{ fontSize: "0.85em", color: "var(--fz-muted)" }}>{d.supplierName}</div>}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[d.status] ?? ""}`}>{d.status}</span>
                </td>
                <td>{d.items}</td>
                <td>{d.offered}</td>
                <td>
                  {d.accepted} ({formatMoney(d.acceptedMinor)})
                </td>
                <td>{d.sentAt ? new Date(d.sentAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
