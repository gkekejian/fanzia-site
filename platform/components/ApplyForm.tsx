"use client";

import { useState, type FormEvent } from "react";
import { TurnstileWidget } from "./Turnstile";

const CHANNEL_TYPES: { value: string; label: string }[] = [
  { value: "vending", label: "Vending" },
  { value: "smoke_shop_convenience", label: "Smoke shop / convenience store" },
  { value: "asian_specialty_retail", label: "Asian specialty retail" },
  { value: "live_seller", label: "Live seller (Whatnot, TikTok Live, etc.)" },
  { value: "event_seller", label: "Event / show seller" },
  { value: "other", label: "Other" },
];

// What the applicant wants to buy (owner request 2026-09-19: know their
// product interests, not just Pokémon). Checkbox values are the
// human-readable labels shown on the admin review screen.
const PRODUCT_INTERESTS: string[] = [
  "Pokémon",
  "Yu-Gi-Oh!",
  "Magic: The Gathering",
  "One Piece",
  "Disney Lorcana",
  "Sports cards",
  "Other TCG / collectibles",
];

type FieldErrors = Record<string, string[]>;

/**
 * Fields the applicant must fill in (mirrors the zod schema in
 * lib/validation/application.ts). Used so the error banner names every
 * missing field instead of only mentioning Terms acceptance.
 */
const REQUIRED_FIELDS: { id: string; label: string }[] = [
  { id: "businessLegalName", label: "Business legal name" },
  { id: "channelType", label: "How you sell" },
  { id: "addressLine1", label: "Business address" },
  { id: "city", label: "City" },
  { id: "state", label: "State" },
  { id: "postalCode", label: "ZIP" },
  { id: "contactName", label: "Your name" },
  { id: "contactEmail", label: "Your email" },
];

/**
 * The interactive application form. `versionLabel` is the published terms
 * version the applicant is accepting; the checkbox label renders the exact
 * visible sentence captured in terms_acceptance (see
 * lib/policies/clickwrap.ts termsClickwrapLabel), with "Terms of Sale"
 * linking to the full document.
 */
export function ApplyForm({ versionLabel }: { versionLabel: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // When the site key is configured the bot check must be solved before
  // submit; when unset the widget renders nothing and the server allows
  // the submission (fail-open — see lib/turnstile.ts).
  const turnstileConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setDuplicateNotice(null);
    setFieldErrors({});

    // Name every missing field in the banner (not just Terms): the form
    // uses noValidate, so an empty submit otherwise reaches the server and
    // comes back with a generic "Invalid input".
    const form = e.currentTarget;
    const missing: string[] = [];
    for (const field of REQUIRED_FIELDS) {
      const value = form.elements.namedItem(field.id);
      const text = value instanceof HTMLInputElement || value instanceof HTMLSelectElement ? value.value : "";
      if (!text.trim()) missing.push(field.label);
    }
    if (!termsAccepted) missing.push("Terms of Sale acceptance");
    if (missing.length > 0) {
      setFormError(`Please fix the following: ${missing.join("; ")}.`);
      return;
    }
    if (turnstileConfigured && !turnstileToken) {
      setFormError("Please complete the bot check before submitting.");
      return;
    }

    const data = new FormData(form);
    const payload = {
      businessLegalName: data.get("businessLegalName"),
      channelType: data.get("channelType"),
      addressLine1: data.get("addressLine1"),
      addressLine2: data.get("addressLine2"),
      city: data.get("city"),
      state: data.get("state"),
      postalCode: data.get("postalCode"),
      country: "US",
      contactName: data.get("contactName"),
      contactEmail: data.get("contactEmail"),
      channelEvidenceUrl: data.get("channelEvidenceUrl"),
      sellersPermitNumber: data.get("sellersPermitNumber"),
      productInterests: data.getAll("productInterests").map(String),
      termsAccepted: true,
      website: data.get("website"), // honeypot
      turnstileToken,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.duplicate) {
          // A live application already exists for this business/email — the
          // server re-emailed the status link; show that as information,
          // not an error.
          setDuplicateNotice(body.error ?? "An application for this business is already under review.");
          setSubmitting(false);
          return;
        }
        // Belt and suspenders: if the server still reports field-level
        // problems, name them in the banner too.
        const serverFields = body.details?.fieldErrors as FieldErrors | undefined;
        if (serverFields) {
          setFieldErrors(serverFields);
          const labels = Object.keys(serverFields).map(
            (key) => REQUIRED_FIELDS.find((f) => f.id === key)?.label ?? key,
          );
          setFormError(`Please fix the following: ${labels.join("; ")}.`);
        } else {
          setFormError(body.error ?? "Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setFormError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="container">
        <div className="card" role="status">
          <h1>Application submitted</h1>
          <p>
            Thanks for applying to Fanzia wholesale. We&apos;ve emailed you a link to check your
            status or add documents at any time.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="draft-banner">DRAFT — PENDING LEGAL REVIEW. Policies referenced below are drafts.</div>
      <div className="card">
        <h1>Wholesale application</h1>
        <p>Fanzia sells at wholesale only to verified businesses. Tell us about yours.</p>

        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        {duplicateNotice && (
          <div className="card" role="status" style={{ marginBottom: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Already in the queue</h2>
            <p>{duplicateNotice}</p>
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="businessLegalName">Business legal name</label>
          <input id="businessLegalName" name="businessLegalName" type="text" required minLength={2} maxLength={200} />
          {fieldErrors.businessLegalName && <p className="field-error">{fieldErrors.businessLegalName[0]}</p>}

          <label htmlFor="channelType">How do you sell?</label>
          <select id="channelType" name="channelType" required defaultValue="">
            <option value="" disabled>
              Select one
            </option>
            {CHANNEL_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <label htmlFor="addressLine1">Business address</label>
          <input id="addressLine1" name="addressLine1" type="text" required minLength={3} maxLength={200} autoComplete="address-line1" />

          <label htmlFor="addressLine2">Address line 2 (optional)</label>
          <input id="addressLine2" name="addressLine2" type="text" maxLength={200} autoComplete="address-line2" />

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="city">City</label>
              <input id="city" name="city" type="text" required maxLength={100} autoComplete="address-level2" />
            </div>
            <div>
              <label htmlFor="state">State</label>
              <input id="state" name="state" type="text" required minLength={2} maxLength={50} autoComplete="address-level1" />
            </div>
            <div>
              <label htmlFor="postalCode">ZIP</label>
              <input id="postalCode" name="postalCode" type="text" required minLength={3} maxLength={20} autoComplete="postal-code" />
            </div>
          </div>

          <label htmlFor="contactName">Your name</label>
          <input id="contactName" name="contactName" type="text" required minLength={2} maxLength={200} autoComplete="name" />

          <label htmlFor="contactEmail">Your email</label>
          <input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" />
          {fieldErrors.contactEmail && <p className="field-error">{fieldErrors.contactEmail[0]}</p>}

          <label htmlFor="sellersPermitNumber">Seller&apos;s permit number (optional, speeds up review)</label>
          <input id="sellersPermitNumber" name="sellersPermitNumber" type="text" maxLength={60} />

          <label htmlFor="channelEvidenceUrl">Link to your storefront or marketplace listing (optional)</label>
          <input id="channelEvidenceUrl" name="channelEvidenceUrl" type="url" placeholder="https://" />

          <fieldset style={{ marginTop: "1rem", border: "1px solid var(--fz-border)", borderRadius: "6px", padding: "0.75rem 1rem" }}>
            <legend style={{ padding: "0 0.4rem", fontWeight: 600 }}>What products are you interested in? (optional)</legend>
            {PRODUCT_INTERESTS.map((p) => (
              <label key={p} style={{ display: "block", fontWeight: 400, margin: "0.3rem 0" }}>
                <input type="checkbox" name="productInterests" value={p} style={{ width: "auto", marginRight: "0.5rem" }} />
                {p}
              </label>
            ))}
          </fieldset>

          {/* Honeypot: hidden from sighted and screen-reader users alike, but still
              tab-reachable-free so it never interferes with real keyboard navigation. */}
          <div style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }} aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input
              id="termsAccepted"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
              aria-required="true"
              style={{ width: "auto", marginTop: "0.2rem" }}
            />
            <label htmlFor="termsAccepted" style={{ margin: 0, fontWeight: 400, fontSize: "0.9rem" }}>
              I have read and agree to Fanzia&apos;s{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms of Sale
              </a>{" "}
              (version {versionLabel}).
            </label>
          </div>

          <TurnstileWidget onToken={setTurnstileToken} onExpire={() => setTurnstileToken(null)} />

          <button type="submit" className="btn" disabled={submitting} style={{ marginTop: "1.5rem" }}>
            {submitting ? "Submitting…" : "Submit application"}
          </button>
        </form>
      </div>
    </main>
  );
}
