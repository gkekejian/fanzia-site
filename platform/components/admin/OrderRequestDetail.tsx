"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type Line = {
  productId: string;
  sku: string;
  name: string;
  qtyRequested: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currencyCode: string;
};

type Detail = {
  orderRequest: {
    id: string;
    lines: Line[];
    notes: string | null;
    subtotalMinor: number;
    smallOrderFeeMinor: number;
    status: string;
    expiresAt: string;
    rolloverCount: number;
    lastRolledOverAt: string | null;
    supersedesId: string | null;
    declineReason: string | null;
    decidedAt: string | null;
    createdAt: string;
  };
  account: { legalName: string; taxStatus: string; city: string; state: string; primaryContactEmail: string } | null;
  contact: { name: string; email: string } | null;
};

export function OrderRequestDetail({ requestId }: { requestId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/order-requests/${requestId}`);
    if (!res.ok) {
      setError("Could not load this order request.");
      return;
    }
    setDetail(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function decide(decision: "approve" | "decline") {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/order-requests/${requestId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, declineReason }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(body.error ?? "Decision failed.");
      return;
    }
    if (decision === "approve") {
      window.location.href = `/admin/invoices/${body.invoice.id}`;
      return;
    }
    await load();
  }

  async function cancel() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/order-requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: declineReason || "Cancelled by owner" }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(body.error ?? "Cancel failed.");
      return;
    }
    await load();
  }

  if (error) {
    return (
      <main className="container">
        <p className="field-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="container">
        <p aria-live="polite">Loading…</p>
      </main>
    );
  }

  const r = detail.orderRequest;
  const total = r.subtotalMinor + (r.smallOrderFeeMinor ?? 0);
  const decided = r.status !== "submitted";

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <h1>Order request</h1>
      <section className="card">
        <p>
          <strong>{detail.account?.legalName ?? "Unknown account"}</strong>
          <br />
          <span style={{ color: "var(--fz-muted)" }}>
            Submitted by {detail.contact?.name} ({detail.contact?.email}) · {new Date(r.createdAt).toLocaleString()}
          </span>
        </p>
        <p>
          Status: <span className="badge">{r.status}</span> · Expires: {new Date(r.expiresAt).toLocaleString()}
          <br />
          <span style={{ color: "var(--fz-muted)" }}>
            Auto-rollover: {(r.rolloverCount ?? 0) > 0 ? `used (${r.rolloverCount}/1)` : "available (1 of 1)"}
            {r.lastRolledOverAt && <> · rolled over {new Date(r.lastRolledOverAt).toLocaleString()}</>}
            {r.supersedesId && (
              <>
                {" "}· reaccepted from <a href={`/admin/order-requests/${r.supersedesId}`}>expired offer</a>
              </>
            )}
          </span>
          <br />
          <span style={{ color: "var(--fz-muted)" }}>
            Tax status: {detail.account?.taxStatus === "exempt" ? "exempt" : "taxable (pending counts as taxable)"}
          </span>
        </p>
        {r.notes && (
          <p>
            <strong>Buyer notes:</strong> {r.notes}
          </p>
        )}
        {r.declineReason && (
          <p>
            <strong>Decline reason:</strong> {r.declineReason}
          </p>
        )}
      </section>

      <table>
        <caption className="visually-hidden">Requested lines</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Line total</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.productId}>
              <td>
                <strong>{l.name}</strong>
                <br />
                <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{l.sku}</span>
              </td>
              <td>{l.qtyRequested}</td>
              <td>{formatMoney(l.unitPriceMinor, l.currencyCode)}</td>
              <td>{formatMoney(l.lineTotalMinor, l.currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Subtotal: {formatMoney(r.subtotalMinor)}
        <br />
        Small-order fee: {r.smallOrderFeeMinor ? formatMoney(r.smallOrderFeeMinor) : "—"}
        <br />
        <strong>Request total: {formatMoney(total)}</strong>
      </p>

      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}

      {r.status === "expired" && (
        <section className="card">
          <h2>Expired offer</h2>
          <p style={{ color: "var(--fz-muted)" }}>
            This offer&apos;s one automatic extension was already used, so it was not extended. The buyer must
            explicitly reaccept the terms (creates a fresh offer) — or you can cancel it below. No payment was
            taken for this offer, so nothing is owed back.
          </p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel}>
            {busy ? "Working…" : "Cancel offer (no refund due)"}
          </button>
        </section>
      )}

      {r.status === "cancelled" && (
        <section className="card">
          <p style={{ color: "var(--fz-muted)" }}>
            This offer was cancelled{ r.decidedAt && <> on {new Date(r.decidedAt).toLocaleString()}</>}. No payment
            was taken, so no refund was due. Cancelled offers cannot be rolled over or reaccepted.
          </p>
        </section>
      )}

      {!decided && (
        <section className="card">
          <h2>Decision</h2>
          <p style={{ color: "var(--fz-muted)" }}>
            Approving creates a draft invoice (tax starts at $0.00 — adjust it on the invoice before sending). The
            buyer&apos;s first order is capped at $5,000.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={() => decide("approve")}>
            {busy ? "Working…" : "Approve and create invoice"}
          </button>
          <div style={{ marginTop: "1.5rem" }}>
            <label htmlFor="decline-reason">Decline reason (required)</label>
            <textarea
              id="decline-reason"
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Why is this request being declined?"
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              style={{ marginTop: "0.75rem" }}
              onClick={() => decide("decline")}
            >
              {busy ? "Working…" : "Decline request"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
