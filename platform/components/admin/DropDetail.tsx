"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/format";
import type { DropDetail as Detail, DropItemView } from "@/lib/offers/drops";
import { ConfirmAction } from "./ConfirmAction";

type CatalogProduct = { id: string; sku: string; name: string; priceMinor: number; unitsPerCase: number | null; sellUnit?: string };

const OFFER_BADGE: Record<string, string> = {
  proposed: "badge-warn",
  offered: "badge-warn",
  paying: "badge-warn",
  accepted: "badge-ok",
  reserved: "badge-ok",
  declined: "badge-bad",
  expired: "badge-bad",
  cancelled: "badge",
};

function dollarsToMinor(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) ? n : NaN;
}

/** Owner: build, review, send and follow one drop. */
export function DropDetail({ dropId }: { dropId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/drops/${dropId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the drop.");
        setDetail(body);
      })
      .catch((e) => setError(e.message));
  }, [dropId]);

  useEffect(() => {
    load();
    fetch("/api/admin/catalog")
      .then(async (res) => (res.ok ? setCatalog((await res.json()).products ?? []) : null))
      .catch(() => {});
  }, [load]);

  async function act(payload: Record<string, unknown>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/drops/${dropId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
      if (body.detail) setDetail(body.detail);
      else load();
      if (payload.action === "supplierRound" && body.roundId) {
        setNotice(`Supplier round created with ${body.added} paid offer line(s).`);
        load();
      } else if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <main className="container">
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : (
          <p aria-live="polite">Loading…</p>
        )}
      </main>
    );
  }

  const { drop, items, totals } = detail;
  const draft = drop.status === "draft";
  const live = drop.status === "live";
  const hasProposals = items.some((i) => i.offers.some((o) => o.status === "proposed"));
  const openOffers = items.reduce((n, i) => n + i.offers.filter((o) => o.status === "offered" || o.status === "paying").length, 0);

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <p>
        <a href="/admin/drops">← All drops</a>
      </p>
      <div className="page-head">
        <div>
          <h1>{drop.name}</h1>
          <p className="page-sub">
            <span className={`badge ${live ? "badge-ok" : draft ? "badge-warn" : ""}`}>{drop.status}</span> · Offer window{" "}
            {drop.offerWindowHours}h, re-offers {drop.reofferWindowHours}h
            {drop.sentAt && <> · sent {new Date(drop.sentAt).toLocaleString()}</>}
          </p>
        </div>
      </div>

      <div className="card" style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <div className="page-sub">Paid</div>
          <strong>{formatMoney(totals.acceptedMinor)}</strong>
        </div>
        <div>
          <div className="page-sub">Waiting on buyers</div>
          <strong>{formatMoney(totals.openMinor)}</strong>
        </div>
        {draft && (
          <div>
            <div className="page-sub">Proposed to buyers</div>
            <strong>{formatMoney(totals.proposedMinor)}</strong>
          </div>
        )}
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="card" role="status">
          {notice}
        </p>
      )}

      {draft && <AddItemForm catalog={catalog} existing={items} busy={busy} onAdd={(p) => act({ action: "setItem", ...p }, "Product saved.")} />}

      {draft && items.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "suggest" }, "Suggested split ready. Review each product below.")}>
            {hasProposals ? "Re-suggest split (replaces edits)" : "Suggest split"}
          </button>
          <ConfirmAction
            label="Send offers"
            confirmLabel="Confirm: email offers to buyers"
            disabled={busy || !hasProposals}
            onConfirm={() => void act({ action: "send" }, "Offers sent.")}
            detail={`Buyers get ${drop.offerWindowHours} hours to Accept & pay. Internal quantities are reserved, not charged.`}
          />
          <ConfirmAction label="Discard draft" confirmLabel="Confirm: discard" danger disabled={busy} onConfirm={() => void act({ action: "cancel" }, "Draft discarded.")} />
        </div>
      )}

      {items.length === 0 && <p>No products yet. Add what you expect to receive from the supplier.</p>}
      {items.map((item) => (
        <ItemSection key={item.id} item={item} dropStatus={drop.status} busy={busy} act={act} />
      ))}

      {(live || drop.status === "closed") && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Ordering from the supplier</h2>
          {drop.supplierRoundId ? (
            <p style={{ marginBottom: 0 }}>
              Supplier round created. <a href={`/admin/allocation-rounds/${drop.supplierRoundId}`}>Open it</a> to order,
              receive and settle any shortfall; use &quot;Pull paid invoices&quot; there to add offers paid later.
            </p>
          ) : (
            <>
              <p>
                Creates a supplier round with every paid offer plus your internal reservation, so ordering, receiving
                and shortfall refunds use the normal round workflow.
              </p>
              <ConfirmAction
                label="Create supplier round"
                confirmLabel="Confirm: create round"
                disabled={busy || !drop.supplierId}
                onConfirm={() => void act({ action: "supplierRound" })}
                detail={drop.supplierId ? undefined : "Set a supplier on the drop first."}
              />
            </>
          )}
          {live && (
            <div style={{ marginTop: "1rem" }}>
              <ConfirmAction
                label="Close drop"
                confirmLabel="Confirm: close drop"
                disabled={busy || openOffers > 0}
                onConfirm={() => void act({ action: "close" }, "Drop closed.")}
                detail={openOffers > 0 ? `${openOffers} offer(s) still open.` : "No more re-offers will go out."}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function AddItemForm({
  catalog,
  existing,
  busy,
  onAdd,
}: {
  catalog: CatalogProduct[];
  existing: DropItemView[];
  busy: boolean;
  onAdd: (p: { productId: string; availableQty: number; unitPriceMinor?: number; increment?: number }) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [increment, setIncrement] = useState("");
  const [filter, setFilter] = useState("");
  const taken = new Set(existing.map((i) => i.productId));
  const options = catalog.filter(
    (p) => !taken.has(p.id) && (!filter || `${p.sku} ${p.name}`.toLowerCase().includes(filter.toLowerCase())),
  );
  const selected = catalog.find((p) => p.id === productId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const unitPriceMinor = dollarsToMinor(price);
    const ok = await onAdd({
      productId,
      availableQty: Math.floor(Number(qty)),
      unitPriceMinor,
      increment: increment.trim() ? Math.floor(Number(increment)) : undefined,
    });
    if (ok) {
      setProductId("");
      setQty("");
      setPrice("");
      setIncrement("");
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ display: "grid", gap: "0.5rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Add a product</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 180px" }}>
          Find
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="SKU or name" />
        </label>
        <label style={{ flex: "2 1 280px" }}>
          Product
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Choose…</option>
            {options.slice(0, 300).map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 120px" }}>
          Quantity ({selected?.sellUnit ?? "units"})
          <input type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          Price each ($)
          <input
            type="number"
            min={0.01}
            step={0.01}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={selected?.priceMinor ? (selected.priceMinor / 100).toFixed(2) : "catalog"}
          />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          Sold in steps of
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={increment}
            onChange={(e) => setIncrement(e.target.value)}
            placeholder={selected?.unitsPerCase ? String(selected.unitsPerCase) : "1"}
          />
        </label>
        <button type="submit" className="btn" disabled={busy || !productId || !qty}>
          Add
        </button>
      </div>
      <p className="page-sub" style={{ margin: 0 }}>
        Blank price uses the current catalog price (card fees are built into your prices). Blank step uses the case size
        when &quot;Sell full cases only&quot; is on.
      </p>
    </form>
  );
}

function ItemSection({
  item,
  dropStatus,
  busy,
  act,
}: {
  item: DropItemView;
  dropStatus: string;
  busy: boolean;
  act: (payload: Record<string, unknown>, done?: string) => Promise<boolean>;
}) {
  const draft = dropStatus === "draft";
  const live = dropStatus === "live";
  const proposed = new Map(item.offers.filter((o) => o.status === "proposed").map((o) => [o.accountId, o.qty]));
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [newQty, setNewQty] = useState("");
  const planned = item.candidates.reduce((s, c) => s + (Number(plan[c.accountId] ?? proposed.get(c.accountId) ?? 0) || 0), 0);
  const edited = Object.keys(plan).length > 0;

  async function savePlan() {
    const rows = item.candidates
      .map((c) => ({ accountId: c.accountId, qty: Math.floor(Number(plan[c.accountId] ?? proposed.get(c.accountId) ?? 0)) || 0 }))
      .filter((r) => r.qty > 0);
    if (await act({ action: "setProposal", itemId: item.id, plan: rows }, `Split saved for ${item.name}.`)) setPlan({});
  }

  return (
    <section className="card" style={{ marginTop: "1rem" }} aria-label={item.name}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{item.name}</h2>
          <div className="page-sub">
            {item.sku} · {formatMoney(item.unitPriceMinor)} per {item.sellUnit}
            {item.increment > 1 && <> · steps of {item.increment}</>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>
            <strong>{item.availableQty}</strong> available · {item.demandQty} wanted
          </div>
          <div className="page-sub">
            {item.acceptedQty} paid · {item.reservedQty} internal · {item.freeQty} free
          </div>
        </div>
      </div>

      {draft && (
        <div style={{ marginTop: "0.5rem" }}>
          <ConfirmAction label="Remove product" confirmLabel="Confirm: remove" danger disabled={busy} onConfirm={() => void act({ action: "removeItem", itemId: item.id })} />
        </div>
      )}

      {live && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end", marginTop: "0.75rem" }}>
          <label>
            Supplier confirmed a different quantity?
            <input type="number" min={0} inputMode="numeric" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder={String(item.availableQty)} />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !newQty.trim()}
            onClick={async () => {
              if (await act({ action: "setItem", productId: item.productId, availableQty: Math.floor(Number(newQty)) }, "Quantity updated.")) setNewQty("");
            }}
          >
            Update quantity
          </button>
          {item.freeQty >= item.increment && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "offerLeftovers", itemId: item.id }, "Offered to the next buyers in line.")}>
              Offer {item.freeQty} free now
            </button>
          )}
        </div>
      )}

      {draft && item.candidates.length > 0 && (
        <>
          <table style={{ marginTop: "0.75rem" }}>
            <caption className="visually-hidden">Buyers who want {item.name}</caption>
            <thead>
              <tr>
                <th scope="col">Buyer</th>
                <th scope="col">Score</th>
                <th scope="col">Wants</th>
                <th scope="col">Offer</th>
              </tr>
            </thead>
            <tbody>
              {item.candidates.map((c) => (
                <tr key={c.accountId}>
                  <td>
                    {c.legalName}
                    {c.internal && <span className="badge" style={{ marginLeft: "0.3rem" }}>internal, filled first</span>}
                    {c.ineligibleReason && <div className="field-error">{c.ineligibleReason}</div>}
                  </td>
                  <td title={c.scoreNotes.join("\n")}>{c.internal ? "—" : c.score ?? "—"}</td>
                  <td>{c.desiredQty}</td>
                  <td>
                    <label className="visually-hidden" htmlFor={`plan-${item.id}-${c.accountId}`}>
                      Offer quantity for {c.legalName}
                    </label>
                    <input
                      id={`plan-${item.id}-${c.accountId}`}
                      className="inline-num"
                      type="number"
                      min={0}
                      step={item.increment}
                      inputMode="numeric"
                      disabled={Boolean(c.ineligibleReason)}
                      value={plan[c.accountId] ?? String(proposed.get(c.accountId) ?? 0)}
                      onChange={(e) => setPlan((p) => ({ ...p, [c.accountId]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem", flexWrap: "wrap" }}>
            <span className={planned > item.availableQty ? "field-error" : "page-sub"}>
              {planned} of {item.availableQty} allocated
            </span>
            {edited && (
              <>
                <button type="button" className="btn" disabled={busy || planned > item.availableQty} onClick={savePlan}>
                  Save split
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setPlan({})}>
                  Undo edits
                </button>
              </>
            )}
          </div>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Hover a score to see why. Scores weigh 12-month spend, payment speed, accepted vs. declined or ignored offers,
            and account age.
          </p>
        </>
      )}
      {draft && item.candidates.length === 0 && <p className="page-sub">Nobody has this on their wants list yet.</p>}

      {!draft && item.offers.length > 0 && (
        <table style={{ marginTop: "0.75rem" }}>
          <caption className="visually-hidden">Offers for {item.name}</caption>
          <thead>
            <tr>
              <th scope="col">Buyer</th>
              <th scope="col">Qty</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Deadline</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {item.offers.map((o) => (
              <tr key={o.id}>
                <td>
                  {o.legalName}
                  {o.wave > 1 && <span className="badge" style={{ marginLeft: "0.3rem" }}>re-offer</span>}
                  {o.declineReason && <div className="page-sub">“{o.declineReason}”</div>}
                  {o.lastPaymentError && o.status === "paying" && <div className="page-sub">Card: {o.lastPaymentError}</div>}
                </td>
                <td>{o.qty}</td>
                <td>{o.internal ? "—" : formatMoney(o.totalMinor)}</td>
                <td>
                  <span className={`badge ${OFFER_BADGE[o.status] ?? ""}`}>{o.internal && o.status === "reserved" ? "internal" : o.status}</span>
                  {o.invoiceId && o.status === "accepted" && (
                    <>
                      {" "}
                      <a href={`/admin/invoices/${o.invoiceId}`}>invoice</a>
                    </>
                  )}
                </td>
                <td>{o.expiresAt && (o.status === "offered" || o.status === "paying") ? new Date(o.expiresAt).toLocaleString() : "—"}</td>
                <td>
                  {live && ["offered", "paying", "reserved"].includes(o.status) && (
                    <ConfirmAction
                      label="Withdraw"
                      confirmLabel="Confirm: withdraw"
                      danger
                      disabled={busy}
                      onConfirm={() => void act({ action: "cancelOffer", offerId: o.id }, "Offer withdrawn.")}
                      detail="Doesn't count against the buyer. Use 'Offer free now' to pass the units on."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
