"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { IMPORT_CLICKWRAP_TEXT } from "@/lib/disclaimers";
import {
  ORDER_MINIMUM_MINOR,
  SMALL_ORDER_FEE_MINOR,
  SMALL_ORDER_THRESHOLD_MINOR,
} from "@/lib/invoicing/rules";
import {
  draftTotals,
  estimateShippingRange,
  milestoneProgress,
  parseQuickOrderLines,
  sellableUnitLabel,
  type ShoppingProduct,
} from "@/lib/member/shopping";
import { useDraft } from "./useDraft";
import { MilestoneProgress } from "./MilestoneProgress";
import { AvailabilityChip } from "./AvailabilityChip";
import { AddToDraftButton } from "./AddToDraftButton";

type SubmitResult = {
  orderRequestId: string;
  subtotalMinor: number;
  smallOrderFeeMinor: number;
  expiresAt: string;
};

export function DraftRequestReview() {
  const [catalog, setCatalog] = useState<ShoppingProduct[]>([]);
  const [importAck, setImportAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [csvText, setCsvText] = useState("");
  const [csvErrors, setCsvErrors] = useState<{ line: number; raw: string; reason: string }[]>([]);
  const [csvAdded, setCsvAdded] = useState(0);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { lines, notes, setNotes, saveNow, qtyById, setQty, replaceAll, saveError } = useDraft();

  useEffect(() => {
    fetch("/api/member/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setCatalog(body.products ?? []);
      })
      .catch(() => {});
  }, []);

  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const priceById = useMemo(
    () => new Map(catalog.map((p) => [p.id, { priceMinor: p.priceMinor }])),
    [catalog],
  );

  const lineDetails = useMemo(() => {
    const details = (lines ?? []).map((line) => {
      const product = productById.get(line.productId) ?? null;
      const lineTotal = product ? product.priceMinor * line.qtyRequested : 0;
      const lineMargin = product && product.marginMinor !== null ? product.marginMinor * line.qtyRequested : null;
      return { line, product, lineTotal, lineMargin };
    });
    return details.sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));
  }, [lines, productById]);

  const totals = useMemo(() => draftTotals(lines ?? [], priceById), [lines, priceById]);
  const progress = useMemo(() => milestoneProgress(totals.subtotalMinor), [totals.subtotalMinor]);
  const shipping = useMemo(() => estimateShippingRange(totals.units), [totals.units]);

  let marginTotalMinor = 0;
  let marginKnown = false;
  for (const d of lineDetails) {
    if (d.lineMargin !== null) {
      marginKnown = true;
      marginTotalMinor += d.lineMargin;
    }
  }
  const marginPct =
    marginKnown && totals.subtotalMinor + marginTotalMinor > 0
      ? (marginTotalMinor / (totals.subtotalMinor + marginTotalMinor)) * 100
      : null;

  const hasImportProduct = (lines ?? []).some((l) => productById.get(l.productId)?.requiresImportAcknowledgment);
  const requestTotalMinor = totals.subtotalMinor + totals.feeMinor;

  function onNotesChange(value: string) {
    setNotes(value);
    setAutosave("saving");
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      saveNow();
      setAutosave("saved");
    }, 800);
  }

  function addCsvLines() {
    const { ok, errors } = parseQuickOrderLines(csvText, catalog);
    setCsvErrors(errors);
    if (ok.length > 0) {
      const merged = new Map((lines ?? []).map((l) => [l.productId, l.qtyRequested]));
      for (const line of ok) {
        merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.qty);
      }
      replaceAll([...merged.entries()].map(([productId, qtyRequested]) => ({ productId, qtyRequested })));
      setCsvAdded(ok.length);
      setCsvText("");
    } else {
      setCsvAdded(0);
    }
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
                {formatMoney(SMALL_ORDER_THRESHOLD_MINOR)} include a {formatMoney(SMALL_ORDER_FEE_MINOR)} fee)
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

  const loading = lines === null;

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>Draft request</h1>
      <div className="draft-banner">
        This is a draft only. Saving it does not submit a request, notify Fanzia, or reserve anything.
      </div>

      {!loading && totals.units > 0 && (
        <div className="card milestone-card" style={{ marginBottom: "1rem" }}>
          <MilestoneProgress subtotalMinor={totals.subtotalMinor} />
        </div>
      )}

      {loading && <p aria-live="polite">Loading…</p>}

      {!loading && totals.units === 0 && (
        <p>
          Your draft is empty. <a href="/member/catalog">Browse the catalog</a> to add items.
        </p>
      )}

      {!loading && totals.units > 0 && (
        <>
          <table className="draft-table">
            <caption className="visually-hidden">Draft request lines</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Unit price</th>
                <th scope="col">Qty</th>
                <th scope="col">Line total</th>
                <th scope="col">Availability</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {lineDetails.map(({ line, product, lineTotal }) => (
                <tr key={line.productId}>
                  <td data-label="Product">
                    {product ? (
                      <>
                        <strong>{sellableUnitLabel(product.name, product.packsPerUnit)}</strong>
                        <br />
                        <span style={{ fontSize: "0.9rem" }}>{product.name}</span>
                        <br />
                        <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{product.sku}</span>
                      </>
                    ) : (
                      <span className="field-error">
                        No longer in the catalog — remove this line before submitting.
                      </span>
                    )}
                  </td>
                  <td data-label="Unit price">{product ? formatMoney(product.priceMinor) : "—"}</td>
                  <td data-label="Qty">
                    {product ? (
                      <AddToDraftButton
                        productId={line.productId}
                        productName={product.name}
                        qty={qtyById.get(line.productId) ?? 0}
                        onChange={setQty}
                        compact
                      />
                    ) : (
                      line.qtyRequested
                    )}
                  </td>
                  <td data-label="Line total">{product ? formatMoney(lineTotal) : "—"}</td>
                  <td data-label="Availability">
                    {product ? <AvailabilityChip product={product} /> : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.8rem" }}
                      onClick={() => setQty(line.productId, 0)}
                      aria-label={`Remove ${product?.name ?? "line"} from draft`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="card totals-block" style={{ marginTop: "1rem" }} aria-live="polite">
            <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Estimated totals</h2>
            <dl className="totals-list">
              <div>
                <dt>
                  Subtotal ({totals.units} unit{totals.units === 1 ? "" : "s"})
                </dt>
                <dd>{formatMoney(totals.subtotalMinor)}</dd>
              </div>
              <div>
                <dt>
                  Small-order fee
                  <span className="totals-hint">orders under {formatMoney(SMALL_ORDER_THRESHOLD_MINOR)}</span>
                </dt>
                <dd>
                  {progress.feeApplies ? (
                    formatMoney(SMALL_ORDER_FEE_MINOR)
                  ) : (
                    <>
                      <s>{formatMoney(SMALL_ORDER_FEE_MINOR)}</s>{" "}
                      <span className="badge badge-ok">Fee dropped — you passed {formatMoney(SMALL_ORDER_THRESHOLD_MINOR)}</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  Estimated shipping
                  <span className="totals-hint">quoted at allocation — this is a planning estimate</span>
                </dt>
                <dd>
                  {shipping.lowMinor === 0 ? "—" : `${formatMoney(shipping.lowMinor)}–${formatMoney(shipping.highMinor)}`}
                </dd>
              </div>
              {marginKnown && (
                <div>
                  <dt>
                    Estimated retail margin at MSRP
                    <span className="totals-hint">vs manufacturer MSRP — an estimate, not a promise</span>
                  </dt>
                  <dd>
                    {formatMoney(marginTotalMinor)}
                    {marginPct !== null && <> ({marginPct.toFixed(1)}%)</>}
                  </dd>
                </div>
              )}
              <div className="totals-grand">
                <dt>Request total (excl. shipping)</dt>
                <dd>{formatMoney(requestTotalMinor)}</dd>
              </div>
            </dl>
            <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem", marginBottom: 0 }}>
              Estimates use current catalog prices. Submitting snapshots the prices at that moment; shipping and
              tax are calculated separately. The {formatMoney(ORDER_MINIMUM_MINOR)} minimum applies to the
              subtotal before fees.
            </p>
          </div>
        </>
      )}

      <label htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" rows={3} value={notes} onChange={(e) => onNotesChange(e.target.value)} />
      <p role="status" style={{ fontSize: "0.85rem", color: "var(--fz-muted)", marginTop: "0.25rem" }}>
        {autosave === "saving" && "Saving…"}
        {autosave === "saved" && "Draft saved ✓"}
        {autosave === "error" && "Could not save — try again."}
      </p>

      <details className="csv-upload" style={{ marginTop: "1rem" }}>
        <summary>Quick order: paste SKUs</summary>
        <p style={{ color: "var(--fz-muted)", fontSize: "0.9rem" }}>
          One <code>SKU, qty</code> per line — matched against the catalog, with per-line errors if anything
          doesn&apos;t resolve.
        </p>
        <label htmlFor="csv-input" className="visually-hidden">
          SKU and quantity lines
        </label>
        <textarea
          id="csv-input"
          rows={4}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"PRIS-EVO-BB, 3\nSTEL-CRY-BB, 2"}
        />
        <button type="button" className="btn btn-secondary" onClick={addCsvLines} disabled={!csvText.trim()}>
          Add lines to draft
        </button>
        {csvAdded > 0 && (
          <p role="status" style={{ marginTop: "0.5rem" }}>
            Added {csvAdded} line{csvAdded === 1 ? "" : "s"} to your draft.
          </p>
        )}
        {csvErrors.length > 0 && (
          <ul role="alert" style={{ marginTop: "0.5rem" }}>
            {csvErrors.map((e, i) => (
              <li key={i} className="field-error">
                Line {e.line} (“{e.raw}”): {e.reason}
              </li>
            ))}
          </ul>
        )}
      </details>

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

      <div className="submit-row" style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          className="btn submit-btn"
          onClick={submit}
          disabled={submitting || totals.units === 0 || !progress.minMet || (hasImportProduct && !importAck)}
        >
          {submitting ? "Submitting…" : `Submit request — ${formatMoney(requestTotalMinor)}`}
        </button>
        {!loading && totals.units > 0 && !progress.minMet && (
          <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
            Your draft is {formatMoney(progress.toMinimumMinor)} under the {formatMoney(ORDER_MINIMUM_MINOR)}{" "}
            minimum — add more to submit.
          </p>
        )}
      </div>
      {hasImportProduct && !importAck && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          Your draft includes imported product — check the box above to acknowledge the import notice before
          submitting.
        </p>
      )}
      {saveError && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          {saveError}
        </p>
      )}
      {submitError && (
        <p className="field-error" role="alert" style={{ marginTop: "0.5rem" }}>
          {submitError}
        </p>
      )}
    </main>
  );
}
