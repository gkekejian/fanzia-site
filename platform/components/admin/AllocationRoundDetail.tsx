"use client";

import { useEffect, useState } from "react";

type DetailLine = {
  id: string;
  accountId: string;
  accountName: string;
  productId: string;
  productSku: string;
  productName: string;
  requestedQty: number;
  allocatedQty: number;
  status: string;
  notes: string | null;
};

type Round = {
  id: string;
  name: string;
  supplierName: string | null;
  status: string;
  cutoffAt: string | null;
  internalAccountId: string | null;
  policySnapshot: { mode?: string; external_split?: string } | null;
  closedAt: string | null;
};

type Summary = { requested: number; allocated: number; shortfallByAccount: Record<string, number> };

const STATUS_BADGE: Record<string, string> = {
  collecting: "badge-warn",
  allocating: "badge-warn",
  closed: "badge-ok",
  ordered: "",
};

const POLICY_PLAIN_WORDS = "Fanzia internal filled first, remainder split pro-rata across external buyers";

export function AllocationRoundDetail({ roundId }: { roundId: string }) {
  const [round, setRound] = useState<Round | null>(null);
  const [lines, setLines] = useState<DetailLine[] | null>(null);
  const [summary, setSummary] = useState<Record<string, Summary>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Allocate inputs, keyed by productId.
  const [available, setAvailable] = useState<Record<string, string>>({});
  const [caseSizes, setCaseSizes] = useState<Record<string, string>>({});

  // Per-line adjustments: lineId -> { qty, reason } (only for changed lines on approve).
  const [adjustQty, setAdjustQty] = useState<Record<string, string>>({});
  const [adjustReason, setAdjustReason] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch(`/api/admin/allocation-rounds/${roundId}`);
    if (!res.ok) {
      setError("Could not load the allocation round.");
      return;
    }
    const body = await res.json();
    setRound(body.allocationRound);
    setLines(body.lines);
    setSummary(body.summaryByProduct ?? {});
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const products = new Map<string, { sku: string; name: string }>();
  for (const l of lines ?? []) {
    if (!products.has(l.productId)) products.set(l.productId, { sku: l.productSku, name: l.productName });
  }

  const canAllocate = round?.status === "collecting" || round?.status === "allocating";
  const canApprove = round?.status === "allocating";

  async function post(path: string, payload: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, body };
  }

  async function runAllocate() {
    setActionMessage(null);
    const availableByProduct: Record<string, number> = {};
    const sizes: Record<string, number> = {};
    for (const pid of products.keys()) {
      const a = Math.floor(Number(available[pid] ?? ""));
      if (!Number.isFinite(a) || a < 0) {
        setActionMessage(`Enter a non-negative available quantity for every product.`);
        return;
      }
      availableByProduct[pid] = a;
      const c = Math.floor(Number(caseSizes[pid] ?? "1"));
      if (Number.isFinite(c) && c > 1) sizes[pid] = c;
    }
    setBusy(true);
    const { ok, body } = await post(`/api/admin/allocation-rounds/${roundId}/allocate`, {
      availableByProduct,
      caseSizes: sizes,
    });
    setBusy(false);
    if (!ok) {
      setActionMessage((body.error as string) ?? "Allocation failed.");
      return;
    }
    setAdjustQty({});
    setAdjustReason({});
    await load();
    setActionMessage("Allocation computed — review the split below before approving.");
  }

  async function approveRound() {
    setActionMessage(null);
    const adjustments: { lineId: string; allocatedQty: number; reason: string }[] = [];
    for (const l of lines ?? []) {
      const raw = adjustQty[l.id];
      if (raw === undefined || raw === "") continue;
      const qty = Math.floor(Number(raw));
      if (!Number.isFinite(qty) || qty < 0) {
        setActionMessage("Adjustment quantities must be non-negative numbers.");
        return;
      }
      if (qty !== l.allocatedQty) {
        const reason = (adjustReason[l.id] ?? "").trim();
        if (!reason) {
          setActionMessage("Every adjustment needs a reason (audit requirement).");
          return;
        }
        adjustments.push({ lineId: l.id, allocatedQty: qty, reason });
      }
    }
    setBusy(true);
    const { ok, body } = await post(`/api/admin/allocation-rounds/${roundId}/approve`, { adjustments });
    setBusy(false);
    if (!ok) {
      setActionMessage((body.error as string) ?? "Approval failed.");
      return;
    }
    setAdjustQty({});
    setAdjustReason({});
    await load();
    setActionMessage("Round approved and closed.");
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      {!round && !error && <p aria-live="polite">Loading…</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {round && (
        <>
          <p>
            <a href="/admin/allocation-rounds">← All rounds</a>
          </p>
          <h1>{round.name}</h1>
          <p>
            <span className={`badge ${STATUS_BADGE[round.status] ?? ""}`}>{round.status}</span>{" "}
            <span style={{ marginLeft: "0.5rem" }}>Distributor: {round.supplierName ?? "—"}</span>
            <span style={{ marginLeft: "0.5rem" }}>
              Cutoff: {round.cutoffAt ? new Date(round.cutoffAt).toLocaleString() : "—"}
            </span>
          </p>
          <p>
            <strong>Fairness policy:</strong> {POLICY_PLAIN_WORDS}. The internal Fanzia row is filled first per
            product; external buyers split what is left pro-rata (largest-remainder), then snapped down to
            case-size multiples. Any external shortfall vs requested is flagged in{" "}
            <span style={{ color: "#c0392b", fontWeight: 700 }}>red</span> below — review before approving.
          </p>

          {actionMessage && (
            <p role="status" style={{ fontWeight: 600 }}>
              {actionMessage}
            </p>
          )}

          {canAllocate && (
            <section aria-label="Run allocation" style={{ marginBottom: "2rem" }}>
              <h2>Run allocation</h2>
              <p>Enter the distributor&apos;s available stock per product and the case size used for snapping.</p>
              <table>
                <caption className="visually-hidden">Distributor availability</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Requested</th>
                    <th scope="col">Available units</th>
                    <th scope="col">Case size</th>
                  </tr>
                </thead>
                <tbody>
                  {[...products.keys()].map((pid) => (
                    <tr key={pid}>
                      <td>
                        {products.get(pid)!.name} <span style={{ color: "#666" }}>({products.get(pid)!.sku})</span>
                      </td>
                      <td>{summary[pid]?.requested ?? "—"}</td>
                      <td>
                        <input
                          aria-label={`Available units for ${products.get(pid)!.name}`}
                          type="number"
                          min={0}
                          value={available[pid] ?? ""}
                          onChange={(e) => setAvailable((m) => ({ ...m, [pid]: e.target.value }))}
                          style={{ maxWidth: "8rem" }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Case size for ${products.get(pid)!.name}`}
                          type="number"
                          min={1}
                          placeholder="1"
                          value={caseSizes[pid] ?? ""}
                          onChange={(e) => setCaseSizes((m) => ({ ...m, [pid]: e.target.value }))}
                          style={{ maxWidth: "8rem" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={runAllocate}>
                {busy ? "Running…" : "Run allocation"}
              </button>
            </section>
          )}

          {[...products.keys()].map((pid) => {
            const s = summary[pid];
            return (
              <section key={pid} aria-label={`Allocation for ${products.get(pid)!.name}`} style={{ marginBottom: "2rem" }}>
                <h2>
                  {products.get(pid)!.name} <span style={{ color: "#666" }}>({products.get(pid)!.sku})</span>
                </h2>
                <table>
                  <caption className="visually-hidden">Buyer allocations</caption>
                  <thead>
                    <tr>
                      <th scope="col">Buyer</th>
                      <th scope="col">Requested</th>
                      <th scope="col">Allocated</th>
                      <th scope="col">Shortfall</th>
                      {canApprove && <th scope="col">Adjust to</th>}
                      {canApprove && <th scope="col">Reason</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(lines ?? [])
                      .filter((l) => l.productId === pid)
                      .map((l) => {
                        const isInternal = round.internalAccountId !== null && l.accountId === round.internalAccountId;
                        const shortfall = l.requestedQty - l.allocatedQty;
                        const flagRed = !isInternal && shortfall > 0;
                        return (
                          <tr key={l.id}>
                            <td>
                              {l.accountName}{" "}
                              {isInternal && (
                                <span
                                  className="badge badge-ok"
                                  title="Our own vending restock, filled first per policy."
                                >
                                  INTERNAL
                                </span>
                              )}
                            </td>
                            <td>{l.requestedQty}</td>
                            <td style={flagRed ? { color: "#c0392b", fontWeight: 700 } : undefined}>
                              {l.allocatedQty}
                              {flagRed && (
                                <span role="img" aria-label="external shortfall" style={{ marginLeft: "0.4rem" }}>
                                  ⚠ short {shortfall}
                                </span>
                              )}
                            </td>
                            <td style={flagRed ? { color: "#c0392b", fontWeight: 700 } : undefined}>
                              {shortfall > 0 ? `−${shortfall}` : "—"}
                            </td>
                            {canApprove && (
                              <td>
                                <input
                                  aria-label={`Adjust allocation for ${l.accountName}`}
                                  type="number"
                                  min={0}
                                  placeholder={String(l.allocatedQty)}
                                  value={adjustQty[l.id] ?? ""}
                                  onChange={(e) => setAdjustQty((m) => ({ ...m, [l.id]: e.target.value }))}
                                  style={{ maxWidth: "7rem" }}
                                />
                              </td>
                            )}
                            {canApprove && (
                              <td>
                                <input
                                  aria-label={`Adjustment reason for ${l.accountName}`}
                                  placeholder="Reason (required)"
                                  value={adjustReason[l.id] ?? ""}
                                  onChange={(e) => setAdjustReason((m) => ({ ...m, [l.id]: e.target.value }))}
                                  style={{ minWidth: "12rem" }}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {s && (
                  <p>
                    Product total — requested <strong>{s.requested}</strong>, allocated{" "}
                    <strong>{s.allocated}</strong>
                    {s.allocated < s.requested && (
                      <span style={{ color: "#c0392b", fontWeight: 700 }}>
                        {" "}
                        (shortfall {s.requested - s.allocated})
                      </span>
                    )}
                  </p>
                )}
              </section>
            );
          })}

          {canApprove && (
            <section aria-label="Approve round" style={{ marginBottom: "2rem" }}>
              <h2>Approve &amp; close</h2>
              <p>
                Closing freezes the split above. Any per-line adjustments you entered are written to the audit
                log with their reasons.
              </p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={approveRound}>
                {busy ? "Closing…" : "Approve & close round"}
              </button>
            </section>
          )}

          {round.status === "closed" && (
            <p>
              Round closed{round.closedAt ? ` ${new Date(round.closedAt).toLocaleString()}` : ""}. The approved
              split is final — invoice generation from closed lines is a later phase.
            </p>
          )}
        </>
      )}
    </main>
  );
}
