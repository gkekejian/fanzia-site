"use client";

import { useEffect, useState } from "react";

type ImportRow = {
  id: string;
  rowNumber: number;
  diffType: "add" | "price_change" | "availability_change" | "msrp_change" | "missing" | "unchanged" | "invalid";
  stagedData: Record<string, unknown>;
  validationErrors: unknown;
  included: boolean;
};

type ImportDetail = {
  import: {
    id: string;
    originalFilename: string;
    fileFormat: string;
    status: "staged" | "approved" | "published" | "rejected";
    rowCount: number;
    createdAt: string;
  };
  rows: ImportRow[];
};

const DIFF_BADGE: Record<string, string> = {
  add: "badge-ok",
  price_change: "badge-warn",
  availability_change: "badge-warn",
  msrp_change: "badge-warn",
  missing: "badge-bad",
  unchanged: "badge",
  invalid: "badge-bad",
};

function formatMoney(minor: unknown, currency: unknown): string {
  if (typeof minor !== "number" || typeof currency !== "string") return "—";
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export function CatalogImportDetail({ importId }: { importId: string }) {
  const [data, setData] = useState<ImportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Publish is a two-step in-page confirmation: the first click arms the
  // button ("Confirm publish"), the second click fires. A native
  // window.confirm is silently auto-dismissed by browser automation, which
  // made the publish POST never fire with no error — a dead button.
  const [publishArmed, setPublishArmed] = useState(false);

  async function load() {
    const res = await fetch(`/api/admin/catalog-imports/${importId}`);
    if (!res.ok) {
      setError("Could not load this import.");
      return;
    }
    setPublishArmed(false);
    setData(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);

  async function toggleRow(rowId: string, included: boolean) {
    const res = await fetch(`/api/admin/catalog-imports/${importId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error ?? "Could not update row.");
      return;
    }
    setData((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.id === rowId ? { ...r, included } : r)) } : prev,
    );
  }

  async function runAction(action: "approve" | "publish" | "reject") {
    setBusy(true);
    setPublishArmed(false);
    setMessage(null);
    const res = await fetch(`/api/admin/catalog-imports/${importId}/${action}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(body.error ?? "Action failed.");
      return;
    }
    setMessage(
      body.proposed
        ? "Queued for owner approval (agent proposal created)."
        : action === "publish"
          ? "Published to the live catalog."
          : action === "approve"
            ? "Diff approved. Publish when ready."
            : "Import rejected.",
    );
    load();
  }

  if (error) {
    return (
      <main className="container">
        <p className="field-error" role="alert">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container" aria-live="polite">Loading…</main>
    );
  }

  const imp = data.import;
  const editable = imp.status === "staged";

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>{imp.originalFilename}</h1>
      <p>
        Status: <span className="badge">{imp.status}</span> · {imp.rowCount} rows · uploaded{" "}
        {new Date(imp.createdAt).toLocaleString()}
      </p>

      {message && (
        <p role="status" className="card">{message}</p>
      )}

      {editable && (
        <section className="card">
          <h2>Review the diff</h2>
          <p>
            Uncheck rows you don&apos;t want in this import. Invalid rows can never be included.
            Approving locks the row selection; publishing writes it to the live catalog.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={busy} onClick={() => runAction("approve")}>
              Approve diff
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => runAction("reject")}>
              Reject import
            </button>
          </div>
        </section>
      )}

      {imp.status === "approved" && (
        <section className="card">
          <h2>Ready to publish</h2>
          <p>This diff is approved. Publishing writes the included rows to the live catalog.</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!publishArmed) {
                setPublishArmed(true);
                return;
              }
              runAction("publish");
            }}
          >
            {publishArmed ? "Confirm publish" : "Publish to live catalog"}
          </button>
          {publishArmed && !busy && (
            <p style={{ marginTop: "0.5rem" }}>
              This will update prices and availability on the live catalog.{" "}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.8rem" }}
                onClick={() => setPublishArmed(false)}
              >
                Cancel
              </button>
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2>Rows ({data.rows.length})</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">SKU</th>
              <th scope="col">Product</th>
              <th scope="col">Change</th>
              <th scope="col">Cost</th>
              <th scope="col">MSRP</th>
              <th scope="col">Stock</th>
              <th scope="col">Include</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const d = row.stagedData;
              const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
              return (
                <tr key={row.id}>
                  <td>{row.rowNumber}</td>
                  <td>{String(d.sku ?? "—")}</td>
                  <td>
                    {String(d.name ?? "—")}
                    <br />
                    <span style={{ color: "var(--fz-muted)", fontSize: "0.8rem" }}>
                      {String(d.supplier_name ?? "")} · {String(d.route_type ?? "")}
                    </span>
                    {errors.length > 0 && (
                      <ul className="field-error" style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem" }}>
                        {errors.map((e, i) => (
                          <li key={i}>{String(e)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${DIFF_BADGE[row.diffType] ?? ""}`}>{row.diffType.replace(/_/g, " ")}</span>
                  </td>
                  <td>{formatMoney(d.cost_minor, d.currency_code)}</td>
                  <td>{typeof d.msrp === "number" ? formatMoney(d.msrp, d.currency_code) : "—"}</td>
                  <td>{d.stock_observed != null ? String(d.stock_observed) : "—"}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Include row ${row.rowNumber} (${String(d.sku ?? "")})`}
                      checked={row.included}
                      disabled={!editable || row.diffType === "invalid"}
                      onChange={(e) => toggleRow(row.id, e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
