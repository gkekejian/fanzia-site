"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatMoney, parseMoneyToMinor } from "@/lib/format";
import { INVOICE_PAYMENT_TERMS } from "@/lib/disclaimers";

type Line = {
  productId: string;
  sku: string;
  name: string;
  qtyRequested: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currencyCode: string;
};

type Payment = {
  id: string;
  amountMinor: number;
  method: string;
  reference: string | null;
  paidAt: string;
  fundsClearedAt: string | null;
  wireConfirmedAt: string | null;
  createdAt: string;
};

type Detail = {
  invoice: {
    id: string;
    invoiceNumber: string;
    lines: Line[];
    subtotalMinor: number;
    smallOrderFeeMinor: number;
    taxMinor: number;
    totalMinor: number;
    currencyCode: string;
    status: string;
    sentAt: string | null;
    createdAt: string;
  };
  account: { legalName: string } | null;
  payments: Payment[];
  clearedMinor: number;
  balanceMinor: number;
  isCleared: boolean;
  readyForFulfillment: boolean;
};

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [taxInput, setTaxInput] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("card");
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    const res = await fetch(`/api/admin/invoices/${invoiceId}`);
    if (!res.ok) {
      setError("Could not load this invoice.");
      return;
    }
    const body: Detail = await res.json();
    setDetail(body);
    setTaxInput((body.invoice.taxMinor / 100).toFixed(2));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Update failed.");
      return;
    }
    await load();
  }

  async function onTaxSave(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoneyToMinor(taxInput);
    if (minor === null) {
      setMessage("Enter a valid tax amount, e.g. 12.50.");
      return;
    }
    await patch({ taxMinor: minor });
  }

  async function onRecordPayment(e: FormEvent) {
    e.preventDefault();
    const amountMinor = parseMoneyToMinor(payAmount);
    if (amountMinor === null || amountMinor <= 0) {
      setMessage("Enter a valid payment amount greater than zero.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountMinor,
        method: payMethod,
        reference: payReference || undefined,
        paidAt: payDate ? new Date(`${payDate}T12:00:00Z`).toISOString() : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Could not record the payment.");
      return;
    }
    setMessage(`${data.amountNote ?? "Payment recorded."} ${data.clearedNote ?? ""}`);
    setPayAmount("");
    setPayReference("");
    await load();
  }

  async function onConfirmWire(paymentId: string) {
    if (!window.confirm("Confirm this wire arrived? Funds will clear immediately.")) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/invoices/${invoiceId}/payments/${paymentId}/confirm-wire`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Could not confirm the wire.");
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

  const inv = detail.invoice;
  const isDraft = inv.status === "draft";
  const canVoid = inv.status === "draft" || inv.status === "sent";

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <h1>Invoice {inv.invoiceNumber}</h1>

      <section className="card">
        <p>
          <strong>{detail.account?.legalName ?? "Unknown account"}</strong>
          <br />
          <span style={{ color: "var(--fz-muted)" }}>
            Created {new Date(inv.createdAt).toLocaleString()}
            {inv.sentAt ? ` · Sent ${new Date(inv.sentAt).toLocaleDateString()}` : ""}
          </span>
        </p>
        <p>
          Status: <span className="badge">{inv.status}</span>
        </p>
        {detail.readyForFulfillment ? (
          <p role="status" style={{ color: "var(--fz-ok, green)", fontWeight: "bold" }}>
            Cleared funds cover the total — ready for fulfillment.
          </p>
        ) : (
          <p style={{ color: "var(--fz-muted)" }}>
            Cleared so far: {formatMoney(detail.clearedMinor)} of {formatMoney(inv.totalMinor)}. Nothing ships before
            cleared funds.
          </p>
        )}
      </section>

      <section className="card" aria-label="Payment terms">
        <h2>Payment terms</h2>
        <p style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{INVOICE_PAYMENT_TERMS}</p>
      </section>

      <table>
        <caption className="visually-hidden">Invoice lines</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Line total</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
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
        Subtotal: {formatMoney(inv.subtotalMinor)}
        <br />
        Small-order fee: {inv.smallOrderFeeMinor ? formatMoney(inv.smallOrderFeeMinor) : "—"}
        <br />
        Tax: {formatMoney(inv.taxMinor)}
        <br />
        <strong>Total: {formatMoney(inv.totalMinor, inv.currencyCode)}</strong>
      </p>

      {isDraft && (
        <section className="card">
          <h2>Adjust tax</h2>
          <form onSubmit={onTaxSave}>
            <label htmlFor="tax">Tax amount (USD)</label>
            <input
              id="tax"
              inputMode="decimal"
              value={taxInput}
              onChange={(e) => setTaxInput(e.target.value)}
              style={{ maxWidth: "12rem" }}
            />
            <button type="submit" className="btn btn-secondary" disabled={busy} style={{ marginLeft: "0.75rem" }}>
              Save tax
            </button>
          </form>
        </section>
      )}

      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}

      <section className="card">
        <h2>Invoice actions</h2>
        {isDraft && (
          <button type="button" className="btn" disabled={busy} onClick={() => patch({ action: "send" })}>
            Mark as sent
          </button>
        )}
        {canVoid && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            style={{ marginLeft: "0.75rem" }}
            onClick={() => {
              if (window.confirm("Void this invoice? Only invoices with no payments can be voided.")) {
                patch({ action: "void" });
              }
            }}
          >
            Void invoice
          </button>
        )}
        {!isDraft && !canVoid && <p style={{ color: "var(--fz-muted)" }}>No actions available in status “{inv.status}”.</p>}
      </section>

      <section className="card">
        <h2>Payments</h2>
        {detail.payments.length === 0 && <p>No payments recorded yet.</p>}
        {detail.payments.length > 0 && (
          <table>
            <caption className="visually-hidden">Recorded payments</caption>
            <thead>
              <tr>
                <th scope="col">Amount</th>
                <th scope="col">Method</th>
                <th scope="col">Paid</th>
                <th scope="col">Cleared</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {formatMoney(p.amountMinor)}
                    {p.reference && (
                      <>
                        <br />
                        <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{p.reference}</span>
                      </>
                    )}
                  </td>
                  <td>{p.method}</td>
                  <td>{new Date(p.paidAt).toLocaleDateString()}</td>
                  <td>
                    {p.fundsClearedAt ? (
                      new Date(p.fundsClearedAt).toLocaleDateString()
                    ) : (
                      <span style={{ color: "var(--fz-muted)" }}>pending wire</span>
                    )}
                  </td>
                  <td>
                    {p.method === "wire" && !p.fundsClearedAt && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        style={{ padding: "0.3rem 0.8rem" }}
                        onClick={() => onConfirmWire(p.id)}
                      >
                        Confirm receipt
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: "var(--fz-muted)" }}>
          Balance due: {formatMoney(detail.balanceMinor)} · card clears immediately · ACH clears in 5 business days
          for the account&apos;s first three payments, 2 after · wire clears only when confirmed.
        </p>
      </section>

      {inv.status !== "void" && inv.status !== "paid" && (
        <section className="card">
          <h2>Record a payment</h2>
          <form onSubmit={onRecordPayment}>
            <label htmlFor="pay-amount">Amount (USD)</label>
            <input
              id="pay-amount"
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0.00"
              style={{ maxWidth: "12rem" }}
            />
            <label htmlFor="pay-method" style={{ marginTop: "0.75rem" }}>
              Method
            </label>
            <select id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ maxWidth: "12rem" }}>
              <option value="card">Card</option>
              <option value="ach">ACH</option>
              <option value="wire">Wire</option>
            </select>
            <label htmlFor="pay-date" style={{ marginTop: "0.75rem" }}>
              Paid on
            </label>
            <input
              id="pay-date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              style={{ maxWidth: "12rem" }}
            />
            <label htmlFor="pay-ref" style={{ marginTop: "0.75rem" }}>
              Reference (optional)
            </label>
            <input
              id="pay-ref"
              value={payReference}
              onChange={(e) => setPayReference(e.target.value)}
              placeholder="Check #, auth code…"
              style={{ maxWidth: "20rem" }}
            />
            <div>
              <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
                {busy ? "Recording…" : "Record payment"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
