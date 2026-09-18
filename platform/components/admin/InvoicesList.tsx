"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  accountName: string;
  totalMinor: number;
  status: string;
  sentAt: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-warn",
  sent: "badge-warn",
  partial: "badge-warn",
  paid: "badge-ok",
  void: "badge-bad",
};

const FILTERS = ["all", "draft", "sent", "partial", "paid", "void"];

export function InvoicesList() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function load(status: string) {
    const qs = status === "all" ? "" : `?status=${status}`;
    const res = await fetch(`/api/admin/invoices${qs}`);
    if (!res.ok) {
      setError("Could not load invoices.");
      return;
    }
    const body = await res.json();
    setRows(body.invoices);
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Invoices</h1>
      <p>
        Invoices are created by approving an order request. Payments are recorded manually here — there is no live
        payment processor. An invoice counts as paid only when <em>cleared</em> funds cover the total.
      </p>
      <label htmlFor="status-filter">Status</label>
      <select id="status-filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: "16rem" }}>
        {FILTERS.map((f) => (
          <option key={f} value={f}>
            {f === "all" ? "All" : f}
          </option>
        ))}
      </select>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!rows && !error && <p aria-live="polite">Loading…</p>}
      {rows && rows.length === 0 && <p>No invoices yet.</p>}
      {rows && rows.length > 0 && (
        <table>
          <caption className="visually-hidden">Invoices</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Account</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Sent</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.invoiceNumber}</strong>
                </td>
                <td>{r.accountName}</td>
                <td>{formatMoney(r.totalMinor)}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td>{r.sentAt ? new Date(r.sentAt).toLocaleDateString() : "—"}</td>
                <td>
                  <a className="btn btn-secondary" href={`/admin/invoices/${r.id}`} style={{ padding: "0.3rem 0.8rem" }}>
                    Open
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
