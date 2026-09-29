"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/format";
import type { BuyerOfferView } from "@/lib/offers/lifecycle";
import type { SavedCard } from "@/lib/offers/cards";

const STATUS_LABEL: Record<string, string> = {
  offered: "Waiting on you",
  paying: "Payment started",
  accepted: "Paid",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Withdrawn",
};

function units(qty: number, unit: string) {
  if (qty === 1) return `1 ${unit}`;
  return `${qty} ${/(x|s|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`}`;
}

function timeLeft(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "closing now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * Buyer offers: each is all or nothing. "Accept & pay" charges the saved
 * card (or opens Stripe Checkout, which saves it); "Decline" passes it on.
 */
export function MemberOffers() {
  const params = useSearchParams();
  const [offers, setOffers] = useState<BuyerOfferView[] | null>(null);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetch("/api/member/offers")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setOffers(body.offers);
        setCard(body.card);
      })
      .catch(() => setError("Could not load your offers."));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Back from Checkout: the webhook may land a moment after the redirect.
  useEffect(() => {
    if (!params.get("paid")) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [params, load]);

  async function accept(o: BuyerOfferView) {
    setBusy(o.id);
    setError(null);
    try {
      const res = await fetch(`/api/member/offers/${o.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ importAcknowledged: Boolean(ack[o.id]) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not take payment. Try again.");
      if (body.status === "checkout" && body.url) {
        window.location.href = body.url;
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not take payment. Try again.");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function decline(o: BuyerOfferView) {
    setBusy(o.id);
    setError(null);
    try {
      const res = await fetch(`/api/member/offers/${o.id}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not decline. Try again.");
      setDeclining(null);
      setReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decline. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const live = (offers ?? []).filter((o) => o.status === "offered" || o.status === "paying");
  const past = (offers ?? []).filter((o) => o.status !== "offered" && o.status !== "paying");

  return (
    <main className="container" style={{ maxWidth: "820px" }}>
      <h1>Offers</h1>
      <p style={{ marginTop: 0 }}>
        When stock lands we offer it to buyers based on what they asked for and their history with us. Each offer is
        all or nothing. Declining or letting one expire is fine, but it does lower your priority for future offers.
      </p>

      {params.get("paid") && (
        <p className="card" role="status">
          Thanks, your payment went through. It can take a moment to show as paid below.
        </p>
      )}
      {params.get("canceled") && (
        <p className="card" role="status">
          Payment canceled, nothing was charged. The offer stays open until its deadline.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <p style={{ color: "var(--fz-muted)" }}>
        {card?.last4 ? (
          <>
            Accept &amp; pay charges your {card.brand ?? "card"} ending {card.last4}. <a href="/member/payment">Change card</a>
          </>
        ) : (
          <>
            No card on file yet: Accept &amp; pay opens a secure Stripe page and saves the card for next time.{" "}
            <a href="/member/payment">Add a card now</a>
          </>
        )}
      </p>

      {!offers && !error && <p aria-live="polite">Loading…</p>}
      {offers && live.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            No open offers right now. Keep <a href="/member/wants">your wants list</a> up to date and we&apos;ll email
            you when something comes in.
          </p>
        </div>
      )}

      {live.map((o) => (
        <article key={o.id} className="card" style={{ marginBottom: "1rem" }} aria-label={`Offer: ${o.productName}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{o.dropName}</div>
              <h2 style={{ margin: "0.2rem 0", fontSize: "1.15rem" }}>{o.productName}</h2>
              <div>
                {units(o.qty, o.sellUnit)} × {formatMoney(o.unitPriceMinor)} ={" "}
                <strong>{formatMoney(o.totalMinor)}</strong>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="badge badge-warn">{STATUS_LABEL[o.status]}</span>
              <div style={{ fontSize: "0.9rem", marginTop: "0.3rem" }}>{timeLeft(o.expiresAt, now)}</div>
            </div>
          </div>

          {o.lastPaymentError && (
            <p className="field-error" role="alert">
              Last card attempt: {o.lastPaymentError} Tap Accept &amp; pay to finish on the secure Stripe page.
            </p>
          )}

          {o.requiresImportAcknowledgment && (
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={Boolean(ack[o.id])}
                onChange={(e) => setAck((a) => ({ ...a, [o.id]: e.target.checked }))}
              />
              <span>
                I understand this is imported product (packaging and language may differ from US retail) and that
                import timing can vary.
              </span>
            </label>
          )}

          {declining === o.id ? (
            <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
              <label>
                Reason (optional, helps us offer better)
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-danger" disabled={busy === o.id} onClick={() => decline(o)}>
                  {busy === o.id ? "Declining…" : "Confirm decline"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setDeclining(null)}>
                  Keep offer
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || (o.requiresImportAcknowledgment && !ack[o.id])}
                onClick={() => accept(o)}
              >
                {busy === o.id ? "Processing…" : `Accept & pay ${formatMoney(o.totalMinor)}`}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setDeclining(o.id)}>
                Decline
              </button>
            </div>
          )}
        </article>
      ))}

      {past.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Last 90 days</h2>
          <table>
            <caption className="visually-hidden">Past offers</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Quantity</th>
                <th scope="col">Total</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {past.map((o) => (
                <tr key={o.id}>
                  <td data-label="Product">
                    {o.productName}
                    <div style={{ fontSize: "0.85em", color: "var(--fz-muted)" }}>{o.dropName}</div>
                  </td>
                  <td data-label="Quantity">{units(o.qty, o.sellUnit)}</td>
                  <td data-label="Total">{formatMoney(o.totalMinor)}</td>
                  <td data-label="Result">
                    <span className={`badge ${o.status === "accepted" ? "badge-ok" : ""}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    {o.status === "accepted" && o.invoiceId && (
                      <>
                        {" "}
                        <a href="/member/invoices">invoice</a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
