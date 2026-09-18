"use client";

/**
 * track3-rollover: minimal buyer UI for the offer rollover policy.
 * A separate worker is redoing buyer-page UX — this component is
 * intentionally small and self-contained so it can be restyled or moved.
 *
 * Shows the offer terms and, when the offer has expired past its one
 * automatic extension, the explicit "review and reaccept" path alongside
 * the cancel-and-refund alternative. Reacceptance is a deliberate buyer
 * action (button click), never implied. Buyer-safe data only: snapshotted
 * line prices and totals — no supplier identity, terms, costs, or markup.
 */

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

type Offer = {
  id: string;
  status: string;
  lines: Line[];
  notes: string | null;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  expiresAt: string;
  createdAt: string;
  rolloverCount: number;
  lastRolledOverAt: string | null;
};

export function ExpiredOfferPrompt({ requestId }: { requestId: string }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reaccept" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [freshOffer, setFreshOffer] = useState<{ id: string; expiresAt: string } | null>(null);

  async function load() {
    const res = await fetch(`/api/member/order-requests/${requestId}`);
    if (!res.ok) {
      setError("Could not load this offer.");
      return;
    }
    const body = await res.json();
    setOffer(body.orderRequest);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function reaccept() {
    setBusy("reaccept");
    setMessage(null);
    const res = await fetch(`/api/member/order-requests/${requestId}/reaccept`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMessage(body.error ?? "Reacceptance failed. Try again.");
      return;
    }
    setFreshOffer({ id: body.orderRequestId, expiresAt: body.expiresAt });
  }

  async function cancel() {
    setBusy("cancel");
    setMessage(null);
    const res = await fetch(`/api/member/order-requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMessage(body.error ?? "Cancel failed. Try again.");
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
  if (!offer) {
    return (
      <main className="container">
        <p aria-live="polite">Loading…</p>
      </main>
    );
  }

  const total = offer.subtotalMinor + (offer.smallOrderFeeMinor ?? 0);

  if (freshOffer) {
    return (
      <main className="container">
        <h1>Offer renewed</h1>
        <div className="card" role="status">
          <p>
            <strong>You reaccepted the offer — a fresh 48-hour offer is now open.</strong>
          </p>
          <p>It is valid until {new Date(freshOffer.expiresAt).toLocaleString()}.</p>
          <p>
            <a href={`/member/order-requests/${freshOffer.id}`}>View the renewed offer</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>{offer.status === "expired" ? "This offer expired" : "Your offer"}</h1>

      {offer.status === "expired" && (
        <div className="card" role="alert">
          <p>
            <strong>Your offer of {formatMoney(total)} expired.</strong> Its one automatic 48-hour extension was
            already used, so it can&apos;t be extended silently.
          </p>
          <p>Review the terms below, then choose:</p>
          <ul>
            <li>
              <strong>Reaccept</strong> — explicitly accept the same terms to open a fresh 48-hour offer.
            </li>
            <li>
              <strong>Cancel</strong> — close the offer. No payment was taken for it, so there is nothing to
              refund.
            </li>
          </ul>
        </div>
      )}

      {offer.status === "submitted" && (
        <div className="card" role="status">
          <p>
            <strong>This offer is live</strong> until {new Date(offer.expiresAt).toLocaleString()}.
            {(offer.rolloverCount ?? 0) > 0 ? (
              <>
                {" "}
                It was automatically extended once; if it expires again you&apos;ll be asked to review and
                reaccept.
              </>
            ) : (
              <>
                {" "}
                If it expires, it is automatically extended once for 48 hours — nothing you need to do.
              </>
            )}
          </p>
        </div>
      )}

      {offer.status === "cancelled" && (
        <div className="card" role="status">
          <p>
            <strong>This offer was cancelled.</strong> No payment was taken for it, so there is nothing to
            refund. You can submit a new request from the catalog any time.
          </p>
          <p>
            <a href="/member/catalog">Back to the catalog</a>
          </p>
        </div>
      )}

      {offer.status === "superseded" && (
        <div className="card" role="status">
          <p>
            <strong>This offer was replaced.</strong> You reaccepted it, and a fresh offer was created with the
            same terms.
          </p>
        </div>
      )}

      {offer.status === "invoiced" && (
        <div className="card" role="status">
          <p>
            <strong>This offer became an invoice.</strong> Check your invoices for payment details.
          </p>
          <p>
            <a href="/member/invoices">View invoices</a>
          </p>
        </div>
      )}

      <section className="card" aria-label="Offer terms">
        <h2>Terms</h2>
        <table>
          <caption className="visually-hidden">Offer lines</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Line total</th>
            </tr>
          </thead>
          <tbody>
            {offer.lines.map((l) => (
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
          Subtotal: {formatMoney(offer.subtotalMinor)}
          <br />
          Small-order fee: {offer.smallOrderFeeMinor ? formatMoney(offer.smallOrderFeeMinor) : "—"}
          <br />
          <strong>Total: {formatMoney(total)}</strong>
        </p>
        {offer.notes && (
          <p>
            <strong>Your notes:</strong> {offer.notes}
          </p>
        )}
      </section>

      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}

      {offer.status === "expired" && (
        <section className="card">
          <h2>Your choice</h2>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={reaccept}
          >
            {busy === "reaccept" ? "Working…" : "Review and reaccept — open a fresh 48-hour offer"}
          </button>
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={cancel}
            >
              {busy === "cancel" ? "Working…" : "Cancel this offer (no payment was taken)"}
            </button>
          </div>
        </section>
      )}

      {offer.status === "submitted" && (
        <section className="card">
          <h2>Cancel this offer</h2>
          <p style={{ color: "var(--fz-muted)" }}>
            No payment was taken for this offer, so there is nothing to refund.
          </p>
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={cancel}>
            {busy === "cancel" ? "Working…" : "Cancel this offer"}
          </button>
        </section>
      )}
    </main>
  );
}
