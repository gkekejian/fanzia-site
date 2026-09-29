"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SavedCard } from "@/lib/offers/cards";

/** Card on file for Accept & pay. Stripe stores the card; we only see brand and last 4. */
export function MemberPayment() {
  const params = useSearchParams();
  const [card, setCard] = useState<SavedCard | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/member/payment-method")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setCard(body.card);
        setCanManage(body.canManage);
        setLoaded(true);
      })
      .catch(() => setError("Could not load your card."));
  }

  useEffect(() => {
    load();
    // The save arrives by webhook a moment after Stripe redirects back.
    if (params.get("saved")) {
      const t = setTimeout(load, 3000);
      return () => clearTimeout(t);
    }
  }, [params]);

  async function addCard() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member/payment-method", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not open the card page. Try again.");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the card page. Try again.");
      setBusy(false);
    }
  }

  async function removeCard() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/member/payment-method", { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not remove the card.");
    setBusy(false);
    load();
  }

  return (
    <main className="container" style={{ maxWidth: "640px" }}>
      <h1>Card on file</h1>
      <p style={{ marginTop: 0 }}>
        When you tap <em>Accept &amp; pay</em> on an offer, this card is charged for that offer only. Nothing is ever
        charged without you accepting. Stripe stores the card; Fanzia only sees the brand and last 4 digits.
      </p>
      {params.get("saved") && (
        <p className="card" role="status">
          Card saved. It can take a moment to show below.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!loaded && !error && <p aria-live="polite">Loading…</p>}
      {loaded && (
        <div className="card">
          {card?.last4 ? (
            <p style={{ marginTop: 0 }}>
              <strong>
                {(card.brand ?? "Card").toUpperCase()} ending {card.last4}
              </strong>
              {card.expMonth && card.expYear && (
                <>
                  {" "}
                  · expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                </>
              )}
            </p>
          ) : (
            <p style={{ marginTop: 0 }}>No card saved. You can still pay offers on the secure Stripe page.</p>
          )}
          {canManage ? (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={busy} onClick={addCard}>
                {busy ? "Opening…" : card?.last4 ? "Replace card" : "Add a card"}
              </button>
              {card?.last4 && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={removeCard}>
                  Remove card
                </button>
              )}
            </div>
          ) : (
            <p style={{ marginBottom: 0, color: "var(--fz-muted)" }}>
              Only your account&apos;s primary contact or purchasers can change the card.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
