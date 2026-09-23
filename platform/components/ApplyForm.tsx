"use client";

import { useState, type FormEvent } from "react";
import { TurnstileWidget } from "./Turnstile";
import { US_STATES } from "@/lib/geo/usStates";
import { ENTITY_TYPE_LABELS, aiDisclosureLabel } from "@/lib/validation/application";

const CHANNEL_TYPES: { value: string; label: string }[] = [
  { value: "vending", label: "Vending" },
  { value: "smoke_shop_convenience", label: "Smoke shop / convenience store" },
  { value: "asian_specialty_retail", label: "Asian specialty retail" },
  { value: "retail_store", label: "Retail store (general)" },
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

const ACCEPTED_FILE_LABEL = "PDF, JPG, PNG, WEBP, or GIF (max 15 MB)";

type FieldErrors = Record<string, string[]>;

/**
 * Fields the applicant must fill in (mirrors the zod schema in
 * lib/validation/application.ts). Used so the error banner names every
 * missing field instead of only mentioning Terms acceptance.
 */
const REQUIRED_FIELDS: { id: string; label: string }[] = [
  { id: "businessLegalName", label: "Business legal name" },
  { id: "entityType", label: "Business entity type" },
  { id: "formationState", label: "State of formation" },
  { id: "channelType", label: "How you sell" },
  { id: "addressLine1", label: "Business address" },
  { id: "city", label: "City" },
  { id: "state", label: "State" },
  { id: "postalCode", label: "ZIP" },
  { id: "locationCount", label: "Number of locations" },
  { id: "expectedMonthlyVolumeUsd", label: "Expected monthly purchase volume" },
  { id: "resaleCertNumber", label: "Resale certificate number" },
  { id: "resaleCertState", label: "Resale certificate state" },
  { id: "contactName", label: "Your name" },
  { id: "contactEmail", label: "Your email" },
  { id: "signatureName", label: "Signature (typed legal name)" },
];

function StateSelect({ id, name, label }: { id: string; name: string; label: string }) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} required defaultValue="">
        <option value="" disabled>
          Select state
        </option>
        {US_STATES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The interactive application form. `versionLabel` is the published terms
 * version the applicant is accepting; the checkbox label renders the exact
 * visible sentence captured in terms_acceptance (see
 * lib/policies/clickwrap.ts termsClickwrapLabel), with "Terms of Sale"
 * linking to the full document.
 *
 * Submits multipart/form-data because the resale certificate copy is
 * uploaded with the application (owner policy 2026-09-20: no submissions
 * without the certificate on file).
 */
export function ApplyForm({ versionLabel }: { versionLabel: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [aiDisclosureAccepted, setAiDisclosureAccepted] = useState(false);
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
    const fileInput = form.elements.namedItem("resaleCertificate");
    if (!(fileInput instanceof HTMLInputElement) || !fileInput.files || fileInput.files.length === 0) {
      missing.push("Resale certificate copy");
    }
    const interestsChecked = form.querySelectorAll('input[name="productInterests"]:checked');
    if (interestsChecked.length === 0) missing.push("Product interests (pick at least one)");
    if (!termsAccepted) missing.push("Terms of Sale acceptance");
    if (!aiDisclosureAccepted) missing.push("AI/automation disclosure acceptance");
    if (missing.length > 0) {
      setFormError(`Please fix the following: ${missing.join("; ")}.`);
      return;
    }
    if (turnstileConfigured && !turnstileToken) {
      setFormError("Please complete the bot check before submitting.");
      return;
    }

    const data = new FormData(form);
    // The checkboxes are controlled; FormData picks up their current state
    // from the DOM. Booleans are sent explicitly so the server doesn't
    // have to guess form-data "on" semantics.
    data.set("termsAccepted", termsAccepted ? "true" : "false");
    data.set("aiDisclosureAccepted", aiDisclosureAccepted ? "true" : "false");
    data.set("turnstileToken", turnstileToken ?? "");
    data.set("country", "US");

    setSubmitting(true);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        body: data, // multipart: file + fields together
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
      <div className="card">
        <h1>Wholesale application</h1>
        <p>Fanzia sells at wholesale only to verified businesses. Tell us about yours.</p>
        <p className="field-note" style={{ marginTop: "-0.5rem" }}>
          We currently sell wholesale <strong>only to businesses organized in the United States</strong> with
          a valid US resale certificate. Applications from non-US entities can&apos;t be approved.
        </p>

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
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Business identity</h2>

          <label htmlFor="businessLegalName">Business legal name</label>
          <input id="businessLegalName" name="businessLegalName" type="text" required minLength={2} maxLength={200} />
          {fieldErrors.businessLegalName && <p className="field-error">{fieldErrors.businessLegalName[0]}</p>}

          <label htmlFor="dba">DBA / trade name (if different)</label>
          <input id="dba" name="dba" type="text" maxLength={200} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="entityType">Business entity type</label>
              <select id="entityType" name="entityType" required defaultValue="">
                <option value="" disabled>
                  Select one
                </option>
                {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <StateSelect id="formationState" name="formationState" label="State of formation" />
          </div>

          <label htmlFor="sosEntityNumber">Secretary of State entity number (optional — speeds up verification)</label>
          <input id="sosEntityNumber" name="sosEntityNumber" type="text" maxLength={60} />

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>What you sell &amp; where</h2>

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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="locationCount">Number of locations</label>
              <input id="locationCount" name="locationCount" type="number" required min={1} step={1} placeholder="e.g. 2" />
            </div>
            <div>
              <label htmlFor="yearsInBusiness">Years in business (optional)</label>
              <input id="yearsInBusiness" name="yearsInBusiness" type="number" min={0} step={1} placeholder="e.g. 5" />
            </div>
          </div>

          <label htmlFor="expectedMonthlyVolumeUsd">Expected monthly purchase volume (USD)</label>
          <input
            id="expectedMonthlyVolumeUsd"
            name="expectedMonthlyVolumeUsd"
            type="number"
            required
            min={1}
            step={1}
            placeholder="e.g. 3000"
          />
          {fieldErrors.expectedMonthlyVolumeUsd && (
            <p className="field-error">{fieldErrors.expectedMonthlyVolumeUsd[0]}</p>
          )}

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Business address</h2>

          <label htmlFor="addressLine1">Business address</label>
          <input id="addressLine1" name="addressLine1" type="text" required minLength={3} maxLength={200} autoComplete="address-line1" />

          <label htmlFor="addressLine2">Address line 2 (optional)</label>
          <input id="addressLine2" name="addressLine2" type="text" maxLength={200} autoComplete="address-line2" />

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="city">City</label>
              <input id="city" name="city" type="text" required maxLength={100} autoComplete="address-level2" />
            </div>
            <StateSelect id="state" name="state" label="State" />
            <div>
              <label htmlFor="postalCode">ZIP</label>
              <input id="postalCode" name="postalCode" type="text" required minLength={3} maxLength={20} autoComplete="postal-code" />
            </div>
          </div>

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Resale certificate (required)</h2>
          <p className="field-note" style={{ marginTop: "-0.5rem" }}>
            We can only sell tax-free with a valid resale certificate on file. Upload a copy now — a clear
            photo works if you don&apos;t have a scan.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="resaleCertNumber">Resale certificate number</label>
              <input id="resaleCertNumber" name="resaleCertNumber" type="text" required maxLength={60} />
            </div>
            <StateSelect id="resaleCertState" name="resaleCertState" label="Issuing state" />
          </div>

          <label htmlFor="resaleCertificate">Upload resale certificate — {ACCEPTED_FILE_LABEL}</label>
          <input id="resaleCertificate" name="resaleCertificate" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" />

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Contact</h2>

          <label htmlFor="contactName">Your name</label>
          <input id="contactName" name="contactName" type="text" required minLength={2} maxLength={200} autoComplete="name" />

          <label htmlFor="contactEmail">Your email</label>
          <input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" />
          {fieldErrors.contactEmail && <p className="field-error">{fieldErrors.contactEmail[0]}</p>}

          <label htmlFor="sellersPermitNumber">Seller&apos;s permit number (optional now — a copy is required before approval)</label>
          <input id="sellersPermitNumber" name="sellersPermitNumber" type="text" maxLength={60} />

          <label htmlFor="channelEvidenceUrl">Link to your storefront or marketplace listing (optional)</label>
          <input id="channelEvidenceUrl" name="channelEvidenceUrl" type="url" placeholder="https://" />

          <label htmlFor="onlinePresence">Sell online? Share your Whatnot, TikTok, or eBay links / usernames (optional)</label>
          <input id="onlinePresence" name="onlinePresence" type="text" maxLength={500} placeholder="e.g. Whatnot: @myshop, TikTok: @myshop" />

          <fieldset style={{ marginTop: "1rem", border: "1px solid var(--fz-border)", borderRadius: "6px", padding: "0.75rem 1rem" }}>
            <legend style={{ padding: "0 0.4rem", fontWeight: 600 }}>What products are you interested in? (pick at least one)</legend>
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

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Signature &amp; agreements</h2>

          <label htmlFor="signatureName">Type your full legal name as your electronic signature</label>
          <input id="signatureName" name="signatureName" type="text" required minLength={2} maxLength={200} autoComplete="name" />
          <p className="field-note" style={{ marginTop: "-0.5rem" }}>
            By signing, you certify that the information above — including the resale certificate — is true
            and correct, and that purchases are for resale.
          </p>

          <div style={{ marginTop: "1rem", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
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

          <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input
              id="aiDisclosureAccepted"
              type="checkbox"
              checked={aiDisclosureAccepted}
              onChange={(e) => setAiDisclosureAccepted(e.target.checked)}
              required
              aria-required="true"
              style={{ width: "auto", marginTop: "0.2rem" }}
            />
            <label htmlFor="aiDisclosureAccepted" style={{ margin: 0, fontWeight: 400, fontSize: "0.9rem" }}>
              {aiDisclosureLabel()}{" "}
              <a href="/ai-policy" target="_blank" rel="noopener noreferrer">
                Read the AI Data-Access Policy
              </a>
              .
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
