"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { computeSmallOrderFee } from "@/lib/invoicing/rules";
import { IMPORT_CLICKWRAP_TEXT } from "@/lib/disclaimers";

type DraftLine = { productId: string; qtyRequested: number };

type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  priceMinor: number;
  currencyCode: string;
  marginMinor: number | null;
  marginBps: number | null;
  requiresImportAcknowledgment?: boolean;
};

type SubmitResult = {
  orderRequestId: string;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  expiresAt: string;
};

export function DraftRequestReview() {
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [importProductIds, setImportProductIds] = useState<Set<string>>(new Set());
  const [importAck, setImportAck] = useState(false);
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
    fetch("/api/member/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        const items = (body.products ?? []) as CatalogProduct[];
        setCatalog(items);
        setImportProductIds(new Set(items.filter((p) => p.requiresImportAcknowledgment).map((p) => p.id)));
      })
      .catch(() => {});
  }, []);

  const hasImportProduct = (lines ?? []).some((l) => importProductIds.has(l.productId));

  // Line details + totals, computed from the already-fetched catalog so the
  // buyer sees names, prices, and margins instead of raw product UUIDs.
  const productById = new Map(catalog.map((p) => [p.id, p]));
  let subtotalMinor = 0;
  let marginTotalMinor = 0;
  let marginKnown = false;
  const lineDetails = (lines ?? []).map((line) => {
    const product = productById.get(line.productId) ?? null;
    const lineTotal = product ? product.priceMinor * line.qtyRequested : 0;
    if (product) subtotalMinor += lineTotal;
    const lineMargin = product && product.marginMinor !== null ? product.marginMinor * line.qtyRequested : null;
    if (lineMargin !== null) {
      marginKnown = true;
      marginTotalMinor += lineMargin;
    }
    return { line, product, lineTotal, lineMargin };
  });
  const feeEstimate = computeSmallOrderFee(subtotalMinor);
  // Buyer's retail margin rate: margin ÷ MSRP-based revenue.
  const marginPct =
    marginKnown && subtotalMinor + marginTotalMinor > 0
      ? (marginTotalMinor / (subtotalMinor + marginTotalMinor)) * 100
      : null;

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
    const res = await fetch("/api/member/draft-request/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importAcknowledged: importAck }),
    });
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
        <>
          <table>
            <caption className="visually-hidden">Draft request lines</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Unit price</th>
                <th scope="col">Quantity</th>
                <th scope="col">Line total</th>
                <th scope="col">Margin at MSRP</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {lineDetails.map(({ line, product, lineTotal, lineMargin }) => (
                <tr key={line.productId}>
                  <td>
                    {product ? (
                      <>
                        <strong>{product.name}</strong>
                        <br />
                        <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{product.sku}</span>
                      </>
                    ) : (
                      <span className="field-error">No longer in the catalog — remove this line before submitting.</span>
                    )}
                  </td>
                  <td>{product ? formatMoney(product.priceMinor) : "—"}</td>
                  <td style={{ width: "6rem" }}>
                    <label htmlFor={`qty-${line.productId}`} className="visually-hidden">
                      Quantity for {product?.name ?? line.productId}
                    </label>
                    <input
                      id={`qty-${line.productId}`}
                      type="number"
                      min={1}
                      value={line.qtyRequested}
                      onChange={(e) => updateQty(line.productId, Number(e.target.value))}
                    />
                  </td>
                  <td>{product ? formatMoney(lineTotal) : "—"}</td>
                  <td title="Your potential retail margin on this line vs manufacturer MSRP">
                    {lineMargin !== null ? formatMoney(lineMargin) : "—"}
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
          <div className="card" style={{ marginTop: "1rem" }} aria-live="polite">
            <strong>Estimated totals</strong>
            <br />
            Subtotal: {formatMoney(subtotalMinor)}
            <br />
            Small-order fee:{" "}
            {feeEstimate > 0
              ? `${formatMoney(feeEstimate)} (orders under ${formatMoney(75000)} include a ${formatMoney(2500)} fee)`
              : `None — this order is over ${formatMoney(75000)}`}
            {marginKnown && (
              <>
                <br />
                Estimated retail margin at MSRP: {formatMoney(marginTotalMinor)}
                {marginPct !== null && <> ({marginPct.toFixed(1)}%)</>}
              </>
            )}
            <br />
            <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
              Estimates use current catalog prices. Submitting snapshots the prices at that moment; shipping and tax
              are calculated separately.
            </span>
          </div>
        </>
      )}
      <label htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {hasImportProduct && (
        <div className="card" style={{ marginTop: "1rem" }} role="group" aria-labelledby="import-ack-label">
          <label htmlFor="import-ack" style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <input
              id="import-ack"
              type="checkbox"
              checked={importAck}
              onChange={(e) => setImportAck(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span id="import-ack-label">{IMPORT_CLICKWRAP_TEXT}</span>
          </label>
        </div>
      )}
      <button type="button" className="btn" style={{ marginTop: "1rem" }} onClick={save} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save draft"}
      </button>{" "}
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: "1rem" }}
        onClick={submit}
        disabled={submitting || !lines || lines.length === 0 || (hasImportProduct && !importAck)}
      >
        {submitting ? "Submitting…" : "Submit order request"}
      </button>
      {hasImportProduct && !importAck && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          Your draft includes imported product — check the box above to acknowledge the import notice before submitting.
        </p>
      )}
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
