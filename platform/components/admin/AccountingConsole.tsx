"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/format";

type Summary = {
  balanceMinor: number;
  inMinor: number;
  outMinor: number;
  receivablesMinor: number;
  overdueCount: number;
};

type Entry = {
  id: string;
  entryDate: string;
  direction: string;
  amountMinor: number;
  category: string;
  notes: string | null;
  runningBalanceMinor: number;
};

type Receivable = {
  invoiceId: string;
  invoiceNumber: string;
  accountName: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  sentAt: string | null;
  daysSinceSent: number | null;
};

const CATEGORIES = ["invoice_payment", "refund", "expense", "adjustment", "owner_contribution"];
const CATEGORY_LABELS: Record<string, string> = {
  invoice_payment: "Invoice payment",
  refund: "Refund",
  expense: "Expense",
  adjustment: "Adjustment",
  owner_contribution: "Owner contribution",
};

export function AccountingConsole() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [directionFilter, setDirectionFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  async function load() {
    const [sumRes, entRes, recRes] = await Promise.all([
      fetch("/api/admin/accounting/summary"),
      fetch(
        `/api/admin/accounting/entries${buildQuery()}`,
      ),
      fetch("/api/admin/accounting/receivables"),
    ]);
    if (sumRes.ok) setSummary(await sumRes.json());
    if (entRes.ok) setEntries((await entRes.json()).entries);
    if (recRes.ok) setReceivables((await recRes.json()).receivables);
    if (!sumRes.ok || !entRes.ok || !recRes.ok) setError("Could not load accounting data.");
  }

  function buildQuery() {
    const qs = new URLSearchParams();
    if (directionFilter !== "all") qs.set("direction", directionFilter);
    if (categoryFilter !== "all") qs.set("category", categoryFilter);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directionFilter, categoryFilter]);

  async function onSync() {
    setBusy(true);
    setSyncMsg(null);
    const res = await fetch("/api/admin/accounting/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Sync failed.");
      return;
    }
    setSyncMsg(body.posted === 0 ? "Nothing new to post — the cashbook is already up to date." : `Posted ${body.posted} cleared payment${body.posted === 1 ? "" : "s"} to the cashbook.`);
    load();
  }

  async function onManualEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const dollars = String(fd.get("amount") ?? "").trim();
    const amountMinor = Math.round(Number(dollars) * 100);
    setBusy(true);
    const res = await fetch("/api/admin/accounting/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryDate: fd.get("entryDate"),
        direction: fd.get("direction"),
        amountMinor,
        category: fd.get("category"),
        notes: fd.get("notes"),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not save the entry.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    load();
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Accounting</h1>
      <p>
        A simple operational cashbook — money in and out plus what customers still owe. This is not double-entry
        accounting and not a replacement for accounting software.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2>Snapshot</h2>
        {!summary && <p aria-live="polite">Loading…</p>}
        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "1rem" }}>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Cash balance</div>
              <strong style={{ fontSize: "1.5rem" }}>{formatMoney(summary.balanceMinor)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Money in</div>
              <strong>{formatMoney(summary.inMinor)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Money out</div>
              <strong>{formatMoney(summary.outMinor)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Receivables (owed)</div>
              <strong>{formatMoney(summary.receivablesMinor)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Unpaid 30+ days</div>
              <strong>{summary.overdueCount}</strong>
            </div>
          </div>
        )}
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="btn" disabled={busy} onClick={onSync}>
            {busy ? "Syncing…" : "Sync cleared payments"}
          </button>
          <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
            Posts every cleared payment that isn&apos;t in the cashbook yet. Safe to run any time — it never
            double-counts.
          </p>
          {syncMsg && <p role="status">{syncMsg}</p>}
        </div>
      </section>

      <section className="card">
        <h2>Receivables</h2>
        {!receivables && <p aria-live="polite">Loading…</p>}
        {receivables && receivables.length === 0 && <p>Nothing outstanding — every sent invoice is fully paid.</p>}
        {receivables && receivables.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Customer</th>
                <th scope="col">Total</th>
                <th scope="col">Paid</th>
                <th scope="col">Remaining</th>
                <th scope="col">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.invoiceId}>
                  <td>
                    <a href={`/admin/invoices/${r.invoiceId}`}>{r.invoiceNumber}</a>
                  </td>
                  <td>{r.accountName}</td>
                  <td>{formatMoney(r.totalMinor)}</td>
                  <td>{formatMoney(r.paidMinor)}</td>
                  <td>
                    <strong>{formatMoney(r.remainingMinor)}</strong>
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {r.daysSinceSent === null ? "—" : r.daysSinceSent === 0 ? "today" : `${r.daysSinceSent} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Cashbook</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <label>
            Direction{" "}
            <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </label>
          <label>
            Category{" "}
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!entries && <p aria-live="polite">Loading…</p>}
        {entries && entries.length === 0 && <p>No entries yet. Record one below or sync cleared payments.</p>}
        {entries && entries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Direction</th>
                <th scope="col">Category</th>
                <th scope="col">Amount</th>
                <th scope="col">Balance</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: "0.85rem" }}>{e.entryDate}</td>
                  <td>{e.direction === "in" ? "In" : "Out"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{CATEGORY_LABELS[e.category] ?? e.category}</td>
                  <td>{formatMoney(e.amountMinor)}</td>
                  <td style={{ fontSize: "0.85rem", color: "var(--fz-muted)" }}>{formatMoney(e.runningBalanceMinor)}</td>
                  <td style={{ fontSize: "0.85rem", maxWidth: "16rem" }}>{e.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Record a manual entry</h2>
        <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
          For refunds, expenses, owner contributions, and adjustments. Invoice payments post automatically via the
          sync button above.
        </p>
        <form onSubmit={onManualEntry}>
          <label htmlFor="ce-date">Date</label>
          <input id="ce-date" name="entryDate" type="date" required />
          <label htmlFor="ce-direction">Direction</label>
          <select id="ce-direction" name="direction" defaultValue="out">
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
          <label htmlFor="ce-amount">Amount (USD)</label>
          <input id="ce-amount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" />
          <label htmlFor="ce-category">Category</label>
          <select id="ce-category" name="category" defaultValue="expense">
            <option value="expense">Expense</option>
            <option value="refund">Refund</option>
            <option value="adjustment">Adjustment</option>
            <option value="owner_contribution">Owner contribution</option>
          </select>
          <label htmlFor="ce-notes">Notes (optional)</label>
          <input id="ce-notes" name="notes" maxLength={500} />
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
            {busy ? "Saving…" : "Record entry"}
          </button>
        </form>
      </section>
    </main>
  );
}
