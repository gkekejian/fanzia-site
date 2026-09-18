"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/format";

type MemberInvoice = {
  id: string;
  invoiceNumber: string;
  totalMinor: number;
  balanceMinor: number;
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

export function MemberInvoices() {
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<MemberInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/member/invoices")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setInvoices(body.invoices);
      })
      .catch(() => setError("Could not load your invoices."));
  }, []);

  async function payByCard(id: string) {
    setPayingId(id);
    setPayError(null);
    const res = await fetch(`/api/member/invoices/${id}/stripe-checkout`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      setPayError(body.error ?? "Could not start card payment. Try again.");
      setPayingId(null);
      return;
    }
    window.location.href = body.url;
  }

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <h1>Invoices</h1>
      {searchParams.get("paid") === "1" && (
        <p role="status" className="card">
          Thank you — your card payment was received. It can take a moment to appear below.
        </p>
      )}
      {searchParams.get("canceled") === "1" && (
        <p role="status" className="card">
          The card payment was canceled. No charge was made — your invoice is unchanged.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!invoices && !error && <p aria-live="polite">Loading…</p>}
      {invoices && invoices.length === 0 && <p>No invoices yet. Approved order requests appear here.</p>}
      {invoices && invoices.length > 0 && (
        <table>
          <caption className="visually-hidden">Your invoices</caption>
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Total</th>
              <th scope="col">Balance due</th>
              <th scope="col">Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const payable = (inv.status === "sent" || inv.status === "partial") && inv.balanceMinor > 0;
              return (
                <tr key={inv.id}>
                  <td>
                    <strong>{inv.invoiceNumber}</strong>
                    <br />
                    <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>{formatMoney(inv.totalMinor)}</td>
                  <td>{formatMoney(inv.balanceMinor)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[inv.status] ?? ""}`}>{inv.status}</span>
                  </td>
                  <td>
                    {payable && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.3rem 0.8rem" }}
                        disabled={payingId === inv.id}
                        onClick={() => payByCard(inv.id)}
                      >
                        {payingId === inv.id ? "Starting…" : "Pay by card"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {payError && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          {payError}
        </p>
      )}
      <p style={{ color: "var(--fz-muted)", marginTop: "1rem" }}>
        Card payments clear immediately. For ACH or wire, contact Fanzia and we&apos;ll record it on your invoice.
      </p>
    </main>
  );
}
