"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type OrderRequestRow = {
  id: string;
  accountName: string;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  status: string;
  expiresAt: string;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  submitted: "badge-warn",
  approved: "badge-ok",
  declined: "badge-bad",
  expired: "badge-bad",
  invoiced: "badge-ok",
};

const FILTERS = ["all", "submitted", "approved", "declined", "expired", "invoiced"];

export function OrderRequestsList() {
  const [rows, setRows] = useState<OrderRequestRow[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function load(status: string) {
    const qs = status === "all" ? "" : `?status=${status}`;
    const res = await fetch(`/api/admin/order-requests${qs}`);
    if (!res.ok) {
      setError("Could not load order requests.");
      return;
    }
    const body = await res.json();
    setRows(body.orderRequests);
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Order requests</h1>
      <p>
        Buyer-submitted requests. Each is an offer that expires 48 hours after submission — approve it to create
        a draft invoice, or decline it with a reason.
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
      {rows && rows.length === 0 && <p>No order requests.</p>}
      {rows && rows.length > 0 && (
        <table>
          <caption className="visually-hidden">Order requests</caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Fee</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.accountName}</td>
                <td>{formatMoney(r.subtotalMinor)}</td>
                <td>{r.smallOrderFeeMinor ? formatMoney(r.smallOrderFeeMinor) : "—"}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td>{new Date(r.expiresAt).toLocaleString()}</td>
                <td>
                  <a className="btn btn-secondary" href={`/admin/order-requests/${r.id}`} style={{ padding: "0.3rem 0.8rem" }}>
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
