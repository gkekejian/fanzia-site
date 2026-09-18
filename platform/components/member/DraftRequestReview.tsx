"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

type DraftLine = { productId: string; qtyRequested: number };

type SubmitResult = {
  orderRequestId: string;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  expiresAt: string;
};

export function DraftRequestReview() {
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);

  useEffect(() => {
    fetch("/api/member/draft-request")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setLines(body.draft?.lines ?? []);
        setNotes(body.draft?.notes ?? "");
      })
      .catch(() => setLines([]));
  }, []);

  async function save() {
    setStatus("saving");
    const res = await fetch("/api/member/draft-request", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: lines ?? [], notes }),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  function removeLine(productId: string) {
    setLines((cur) => (cur ?? []).filter((l) => l.productId !== productId));
  }

  function updateQty(productId: string, qty: number) {
    setLines((cur) => (cur ?? []).map((l) => (l.productId === productId ? { ...l, qtyRequested: qty } : l)));
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    const res = await fetch("/api/member/draft-request/submit", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(body.error ?? "Could not submit your request. Try again.");
      return;
    }
    setSubmitted({
      orderRequestId: body.orderRequestId,
      subtotalMinor: body.subtotalMinor,
      smallOrderFeeMinor: body.smallOrderFeeMinor,
      expiresAt: body.expiresAt,
    });
    setLines([]);
  }

  if (submitted) {
    return (
      <main className="container">
        <h1>Request submitted</h1>
        <div className="card" role="status">
          <p>
            <strong>Thank you — your order request is in.</strong>
          </p>
          <p>
            Subtotal: {formatMoney(submitted.subtotalMinor)}
            {submitted.smallOrderFeeMinor > 0 && (
              <>
                <br />
                Small-order fee: {formatMoney(submitted.smallOrderFeeMinor)} (orders under{" "}
                {formatMoney(75000)} include a {formatMoney(2500)} fee)
              </>
            )}
          </p>
          <p>
            Our team reviews every request before it becomes an invoice. This offer expires{" "}
            {new Date(submitted.expiresAt).toLocaleString()} — 48 hours after submission.
          </p>
          <p>
            <a href="/member/catalog">Back to the catalog</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Draft request</h1>
      <div className="draft-banner">
        This is a draft only. Saving it does not submit a request, notify Fanzia, or reserve anything.
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <strong>Before you submit:</strong> wholesale orders have a {formatMoney(50000)} minimum. Orders under{" "}
        {formatMoney(75000)} include a {formatMoney(2500)} small-order fee, shown before you confirm. Every request
        is reviewed by our team and expires 48 hours after submission.
      </div>
      {lines === null && <p aria-live="polite">Loading…</p>}
      {lines && lines.length === 0 && (
        <p>
          Your draft is empty. <a href="/member/catalog">Browse the catalog</a> to add items.
        </p>
      )}
      {lines && lines.length > 0 && (
        <table>
          <caption className="visually-hidden">Draft request lines</caption>
          <thead>
            <tr>
              <th scope="col">Product ID</th>
              <th scope="col">Quantity</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.productId}>
                <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{line.productId}</td>
                <td style={{ width: "6rem" }}>
                  <label htmlFor={`qty-${line.productId}`} className="visually-hidden">
                    Quantity
                  </label>
                  <input
                    id={`qty-${line.productId}`}
                    type="number"
                    min={1}
                    value={line.qtyRequested}
                    onChange={(e) => updateQty(line.productId, Number(e.target.value))}
                  />
                </td>
                <td>
                  <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem" }} onClick={() => removeLine(line.productId)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" className="btn" style={{ marginTop: "1rem" }} onClick={save} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save draft"}
      </button>{" "}
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: "1rem" }}
        onClick={submit}
        disabled={submitting || !lines || lines.length === 0}
      >
        {submitting ? "Submitting…" : "Submit order request"}
      </button>
      {submitError && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          {submitError}
        </p>
      )}
      {status === "saved" && (
        <p role="status" style={{ marginTop: "0.5rem" }}>
          Draft saved.
        </p>
      )}
      {status === "error" && (
        <p className="field-error" role="alert">
          Could not save the draft. Try again.
        </p>
      )}
    </main>
  );
}
