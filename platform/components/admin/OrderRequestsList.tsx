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
  rolloverCount: number;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  submitted: "badge-warn",
  approved: "badge-ok",
  declined: "badge-bad",
  expired: "badge-bad",
  invoiced: "badge-ok",
  cancelled: "badge-bad",
  superseded: "",
};

const FILTERS = ["all", "submitted", "approved", "declined", "expired", "invoiced", "cancelled", "superseded"];

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

  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  async function runExpirySweep() {
    setSweepBusy(true);
    setSweepMessage(null);
    const res = await fetch("/api/admin/order-requests/process-expiry", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSweepBusy(false);
    if (!res.ok) {
      setSweepMessage(body.error ?? "Expiry check failed.");
      return;
    }
    const rolled: string[] = body.rolledOver ?? [];
    const expired: string[] = body.expired ?? [];
    setSweepMessage(
      `Expiry check done — ${rolled.length} offer${rolled.length === 1 ? "" : "s"} auto-rolled over, ${expired.length} expired.`,
    );
    await load(filter);
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Order requests</h1>
      <p>
        Buyer-submitted requests. Each is an offer that expires 48 hours after submission — approve it to create
        a draft invoice, or decline it with a reason. The first expiry is automatically extended once (rollover);
        any later expiry needs the buyer to reaccept.
      </p>
      <div style={{ display: "flex", gap: "1rem", alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="status-filter">Status</label>
          <select id="status-filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: "16rem" }}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All" : f}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" disabled={sweepBusy} onClick={runExpirySweep}>
          {sweepBusy ? "Checking…" : "Run expiry check now"}
        </button>
      </div>
      {sweepMessage && (
        <p role="status" style={{ marginTop: "0.5rem" }}>
          {sweepMessage}
        </p>
      )}

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
              <th scope="col">Rollover</th>
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
                <td>{r.rolloverCount > 0 ? `used (${r.rolloverCount}/1)` : "available"}</td>
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
