"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type OrderRequestLine = {
  productId: string;
  sku: string;
  name: string;
  qtyRequested: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currencyCode: string;
};

type OrderRequest = {
  id: string;
  lines: OrderRequestLine[];
  notes: string | null;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  status: string;
  expiresAt: string;
  decidedAt: string | null;
  declineReason: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "Under review",
  approved: "Approved",
  declined: "Declined",
  expired: "Expired",
  invoiced: "Invoiced",
};

const STATUS_BADGE: Record<string, string> = {
  submitted: "badge-warn",
  approved: "badge-ok",
  declined: "badge-bad",
  expired: "badge",
  invoiced: "badge-ok",
};

/**
 * Buyer-visible order-request history. Every row links to the detail page
 * (approved requests also show their invoices via /member/invoices once
 * issued).
 */
export function MemberOrderRequests() {
  const [requests, setRequests] = useState<OrderRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/member/order-requests")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load your order requests.");
        const body = await res.json();
        setRequests(body.orderRequests);
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    );
  }
  if (!requests) {
    return <p aria-live="polite">Loading…</p>;
  }
  if (requests.length === 0) {
    return (
      <div className="card">
        <h1>Order requests</h1>
        <p>
          You haven&apos;t submitted any order requests yet. Build one from the{" "}
          <a href="/member/catalog">catalog</a> — submitting a request is an offer,
          not a purchase; our team reviews it within the 48-hour offer window.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Order requests</h1>
      <table>
        <caption className="visually-hidden">Your order requests</caption>
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Status</th>
            <th>Items</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const lines = Array.isArray(r.lines) ? r.lines : [];
            const total = r.subtotalMinor + r.smallOrderFeeMinor;
            const currency = lines[0]?.currencyCode ?? "USD";
            return (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? "badge"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td>{lines.reduce((n, l) => n + (l.qtyRequested ?? 0), 0)}</td>
                <td>{formatMoney(total, currency)}</td>
                <td>
                  <a href={`/member/order-requests/${r.id}`}>View</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
