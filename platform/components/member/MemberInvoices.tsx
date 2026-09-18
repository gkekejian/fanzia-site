"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/format";

type MemberShipment = {
  status: string;
  carrier: string;
  trackingNumber: string;
  shippedAt: string | null;
  deliveredAt: string | null;
};

type MemberInvoice = {
  id: string;
  invoiceNumber: string;
  totalMinor: number;
  balanceMinor: number;
  status: string;
  sentAt: string | null;
  createdAt: string;
  shipment: MemberShipment | null;
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-warn",
  sent: "badge-warn",
  partial: "badge-warn",
  paid: "badge-ok",
  void: "badge-bad",
};

export function MemberInvoices() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<MemberInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderSkipped, setReorderSkipped] = useState<{ name: string; reason: string }[] | null>(null);

  useEffect(() => {
    fetch("/api/member/invoices")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setInvoices(body.invoices);
      })
      .catch(() => setError("Could not load your invoices."));
  }, []);

  async function reorder(id: string) {
    setReorderingId(id);
    setReorderError(null);
    setReorderSkipped(null);
    const res = await fetch("/api/member/draft-request/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: id }),
    });
    const body = await res.json().catch(() => ({}));
    setReorderingId(null);
    if (!res.ok) {
      setReorderError(body.error ?? "Could not reorder these items. Try again.");
      return;
    }
    const skipped = (body.skipped ?? []) as { name: string; reason: string }[];
    if (skipped.length === 0) {
      router.push("/member/draft-request");
    } else {
      // Some items couldn't come along — say so honestly and let the buyer
      // decide whether to continue with the rest.
      setReorderSkipped(skipped);
    }
  }
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
        <table className="responsive-table">
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
              const paid = inv.status === "paid";
              return (
                <tr key={inv.id}>
                  <td data-label="Invoice">
                    <strong>{inv.invoiceNumber}</strong>
                    <br />
                    <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </span>
                    {inv.shipment && (
                      <>
                        <br />
                        <span style={{ fontSize: "0.85rem" }}>
                          {inv.shipment.status === "delivered"
                            ? `Delivered via ${inv.shipment.carrier}`
                            : inv.shipment.status === "shipped"
                              ? `Shipped via ${inv.shipment.carrier}`
                              : `Preparing shipment via ${inv.shipment.carrier}`}
                          <br />
                          <span style={{ color: "var(--fz-muted)" }}>
                            Tracking: <span style={{ fontFamily: "monospace" }}>{inv.shipment.trackingNumber}</span>
                          </span>
                        </span>
                      </>
                    )}
                  </td>
                  <td data-label="Total">{formatMoney(inv.totalMinor)}</td>
                  <td data-label="Balance due">{formatMoney(inv.balanceMinor)}</td>
                  <td data-label="Status">
                    <span className={`badge ${STATUS_BADGE[inv.status] ?? ""}`}>{inv.status}</span>
                  </td>
                  <td className="invoice-actions">
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
                    <br />
                    <button
                      type="button"
                      className={`btn ${paid ? "" : "btn-secondary"}`}
                      style={{ padding: "0.3rem 0.8rem", marginTop: "0.4rem" }}
                      disabled={reorderingId === inv.id}
                      onClick={() => reorder(inv.id)}
                      title="Copy this invoice's items into a new draft request"
                    >
                      {reorderingId === inv.id ? "Adding…" : "Reorder these items"}
                    </button>
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
      {reorderError && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          {reorderError}
        </p>
      )}
      {reorderSkipped && reorderSkipped.length > 0 && (
        <div className="card" role="status" style={{ marginTop: "0.5rem" }}>
          <strong>Added what we could — but some items couldn&apos;t come along:</strong>
          <ul>
            {reorderSkipped.map((s, i) => (
              <li key={i}>
                <strong>{s.name}</strong> — {s.reason}
              </li>
            ))}
          </ul>
          <p>
            <a href="/member/draft-request">Continue to your draft →</a>
          </p>
        </div>
      )}
      <p style={{ color: "var(--fz-muted)", marginTop: "1rem" }}>
        Card payments clear immediately. For ACH or wire, contact Fanzia and we&apos;ll record it on your invoice.
      </p>
    </main>
  );
}
