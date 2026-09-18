"use client";

import { useEffect, useState } from "react";

type RoundRow = {
  id: string;
  name: string;
  supplierName: string;
  status: string;
  cutoffAt: string | null;
  lineCount: number;
  createdAt: string;
};

type SupplierOption = { id: string; name: string };

const STATUS_BADGE: Record<string, string> = {
  collecting: "badge-warn",
  allocating: "badge-warn",
  closed: "badge-ok",
  ordered: "",
};

const POLICY_DESCRIPTION = "Fanzia internal filled first, remainder split pro-rata across external buyers";

export function AllocationRoundsList() {
  const [rows, setRows] = useState<RoundRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [cutoffAt, setCutoffAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/allocation-rounds");
    if (!res.ok) {
      setError("Could not load allocation rounds.");
      return;
    }
    const body = await res.json();
    setRows(body.allocationRounds);
  }

  async function loadSuppliers() {
    const res = await fetch("/api/admin/suppliers");
    if (!res.ok) return;
    const body = await res.json();
    setSuppliers(body.suppliers ?? []);
  }

  useEffect(() => {
    load();
    loadSuppliers();
  }, []);

  async function createRound(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    const res = await fetch("/api/admin/allocation-rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        supplierId,
        cutoffAt: cutoffAt || undefined,
        policy: "fanzia_first",
      }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setCreateError(body.error ?? "Could not create the round.");
      return;
    }
    setName("");
    setSupplierId("");
    setCutoffAt("");
    await load();
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Allocation rounds</h1>
      <p>
        Batch stock splits against a distributor order window. Requests collect while a round is{" "}
        <em>collecting</em>; at cutoff the owner runs <em>Allocate</em>, reviews the proposed split, then{" "}
        <em>approves</em> to close. Fairness policy: {POLICY_DESCRIPTION}.
      </p>

      <section aria-label="Create a round" style={{ marginBottom: "2rem" }}>
        <h2>New round</h2>
        <form onSubmit={createRound} style={{ display: "flex", gap: "1rem", alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="round-name">Round name</label>
            <input
              id="round-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. King Punch October order"
              required
              style={{ minWidth: "18rem" }}
            />
          </div>
          <div>
            <label htmlFor="round-supplier">Distributor</label>
            <select
              id="round-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              style={{ minWidth: "14rem" }}
            >
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="round-cutoff">Cutoff (optional)</label>
            <input
              id="round-cutoff"
              type="datetime-local"
              value={cutoffAt}
              onChange={(e) => setCutoffAt(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="round-policy">Fairness policy</label>
            <select id="round-policy" disabled style={{ minWidth: "20rem" }} value="fanzia_first">
              <option value="fanzia_first">
                Fanzia internal filled first, remainder split pro-rata across external buyers
              </option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? "Creating…" : "Create round"}
          </button>
        </form>
        {createError && (
          <p className="field-error" role="alert">
            {createError}
          </p>
        )}
      </section>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!rows && !error && <p aria-live="polite">Loading…</p>}
      {rows && rows.length === 0 && <p>No allocation rounds yet.</p>}
      {rows && rows.length > 0 && (
        <table>
          <caption className="visually-hidden">Allocation rounds</caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Distributor</th>
              <th scope="col">Status</th>
              <th scope="col">Lines</th>
              <th scope="col">Cutoff</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.supplierName}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td>{r.lineCount}</td>
                <td>{r.cutoffAt ? new Date(r.cutoffAt).toLocaleString() : "—"}</td>
                <td>
                  <a className="btn btn-secondary" href={`/admin/allocation-rounds/${r.id}`} style={{ padding: "0.3rem 0.8rem" }}>
                    Review
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
