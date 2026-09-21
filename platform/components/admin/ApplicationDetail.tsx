"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  DECISION_REASONS,
  defaultReasonCode,
  type ApplicationDecision,
} from "@/lib/applications/decisionReasons";
import {
  buildBusinessSummary,
  runApplicationChecks,
  type CheckStatus,
} from "@/lib/applications/summary";
import { ConfirmAction } from "./ConfirmAction";

type Document = {
  id: string;
  docType: string;
  originalFilename: string;
  mimeVerified: string;
  storageKey: string;
  url: string;
};

type ApplicationData = {
  application: {
    id: string;
    businessLegalName: string;
    dba: string | null;
    entityType: string | null;
    formationState: string | null;
    sosEntityNumber: string | null;
    status: string;
    accountId: string | null;
    channelType: string;
    contactName: string;
    contactEmail: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    locationCount: number | null;
    yearsInBusiness: number | null;
    expectedMonthlyVolumeUsd: number | null;
    resaleCertNumber: string | null;
    resaleCertState: string | null;
    signatureName: string | null;
    aiDisclosureAcceptedAt: string | null;
    sellersPermitNumber: string | null;
    channelEvidenceUrl: string | null;
    productInterests: unknown;
    onlinePresence: string | null;
    triageScore: number;
    needsReviewReasons: string[];
    decisionReason: string | null;
  };
  documents: Document[];
  taxDeterminations: { id: string; status: string; notes: string; determinedAt: string }[];
};

function DocumentPreview({ doc }: { doc: Document }) {
  if (doc.mimeVerified === "application/pdf") {
    return <iframe title={doc.originalFilename} src={doc.url} style={{ width: "100%", height: "480px", border: "1px solid var(--fz-border)" }} />;
  }
  if (doc.mimeVerified.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={doc.url} alt={`${doc.docType.replace(/_/g, " ")} document: ${doc.originalFilename}`} style={{ maxWidth: "100%", border: "1px solid var(--fz-border)" }} />;
  }
  return (
    <a href={doc.url} target="_blank" rel="noopener noreferrer">
      Open {doc.originalFilename}
    </a>
  );
}

export function ApplicationDetail({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<ApplicationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [decision, setDecision] = useState<ApplicationDecision>("approved");
  const [reasonCode, setReasonCode] = useState(defaultReasonCode("approved"));
  const [reasonNote, setReasonNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [taxStatus, setTaxStatus] = useState("exempt");
  const [taxEvidenceKey, setTaxEvidenceKey] = useState("");
  const [taxNotes, setTaxNotes] = useState("");

  function onDecisionChange(next: ApplicationDecision) {
    setDecision(next);
    setReasonCode(defaultReasonCode(next));
    setReasonNote("");
  }

  async function load() {
    const res = await fetch(`/api/admin/applications/${applicationId}`);
    if (!res.ok) {
      setError("Could not load this application.");
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  /**
   * Recording a decision is one-way (applicant gets emailed, an approval
   * creates a buyer account) — it fires only through ConfirmAction's
   * second click, never on plain form submit.
   */
  async function fireDecision() {
    setBusy(true);
    setActionMessage(null);
    const res = await fetch(`/api/admin/applications/${applicationId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reasonCode, reasonNote: reasonNote || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setActionMessage(body.error ?? "Action failed.");
      return;
    }
    setActionMessage(body.proposed ? "Queued for owner approval (agent proposal created)." : `Application ${decision.replace("_", " ")}.`);
    load();
  }

  async function onTaxSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setActionMessage(null);
    const res = await fetch(`/api/admin/applications/${applicationId}/tax-determination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: taxStatus, evidenceObjectKey: taxEvidenceKey || null, notes: taxNotes }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setActionMessage(body.error ?? "Tax determination failed.");
      return;
    }
    setActionMessage(body.proposed ? "Queued for owner approval (agent proposal created)." : "Tax determination recorded.");
    load();
  }

  if (error) {
    return (
      <main className="container">
        <p className="field-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container" aria-live="polite">
        Loading…
      </main>
    );
  }

  const app = data.application;
  const summary = buildBusinessSummary(app, data.documents);
  const checks = runApplicationChecks(app, data.documents);

  const CHECK_BADGE: Record<CheckStatus, string> = {
    pass: "badge badge-ok",
    fail: "badge badge-bad",
    unknown: "badge badge-warn",
  };
  const CHECK_LABEL: Record<CheckStatus, string> = {
    pass: "Pass",
    fail: "Fail",
    unknown: "Unknown",
  };

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>{app.businessLegalName}</h1>
      <p>
        Status: <span className="badge">{app.status}</span> · Triage score: {app.triageScore}
      </p>
      {app.needsReviewReasons.length > 0 && (
        <ul>
          {app.needsReviewReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <section className="card" aria-label="Business summary">
        <h2>Business summary</h2>
        <dl>
          {summary.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <h3>Checks</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {checks.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.4rem" }}>
              <span className={CHECK_BADGE[c.status]}>{CHECK_LABEL[c.status]}</span>{" "}
              <strong>{c.label}</strong> — {c.detail}
            </li>
          ))}
        </ul>
      </section>
      {actionMessage && (
        <p role="status" className="card">
          {actionMessage}
        </p>
      )}

      <section className="card">
        <h2>Application details</h2>
        <dl>
          <dt>Channel</dt>
          <dd>{app.channelType.replace(/_/g, " ")}</dd>
          <dt>DBA</dt>
          <dd>{app.dba || "None"}</dd>
          <dt>Entity type</dt>
          <dd>
            {app.entityType
              ? `${app.entityType.replace(/_/g, " ")}${app.formationState ? ` — formed in ${app.formationState}` : ""}`
              : "Not collected (legacy application)"}
          </dd>
          <dt>Secretary of State entity #</dt>
          <dd>{app.sosEntityNumber || "Not provided"}</dd>
          <dt>Locations</dt>
          <dd>{app.locationCount ?? "Not collected"}</dd>
          <dt>Years in business</dt>
          <dd>{app.yearsInBusiness ?? "Not provided"}</dd>
          <dt>Expected monthly volume</dt>
          <dd>
            {app.expectedMonthlyVolumeUsd != null && app.expectedMonthlyVolumeUsd > 0
              ? app.expectedMonthlyVolumeUsd.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })
              : "Not collected"}
          </dd>
          <dt>Resale certificate</dt>
          <dd>
            {app.resaleCertNumber
              ? `${app.resaleCertNumber}${app.resaleCertState ? ` (${app.resaleCertState})` : ""}`
              : "Not provided"}
          </dd>
          <dt>Contact</dt>
          <dd>
            {app.contactName} — {app.contactEmail}
          </dd>
          <dt>Address</dt>
          <dd>
            {app.addressLine1}, {app.city}, {app.state} {app.postalCode}
          </dd>
          <dt>Seller&apos;s permit</dt>
          <dd>{app.sellersPermitNumber || "Not provided"}</dd>
          <dt>Channel evidence</dt>
          <dd>{app.channelEvidenceUrl || "Not provided"}</dd>
          <dt>Sells online</dt>
          <dd>{app.onlinePresence || "Not provided"}</dd>
          <dt>Product interests</dt>
          <dd>
            {Array.isArray(app.productInterests) && app.productInterests.length > 0
              ? (app.productInterests as string[]).join(", ")
              : "Not specified"}
          </dd>
          <dt>Signed by</dt>
          <dd>{app.signatureName || "Not collected (legacy application)"}</dd>
          <dt>AI disclosure</dt>
          <dd>{app.aiDisclosureAcceptedAt ? `Accepted ${app.aiDisclosureAcceptedAt}` : "Not collected (legacy application)"}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Documents</h2>
        {data.documents.length === 0 ? (
          <p>No documents uploaded.</p>
        ) : (
          data.documents.map((doc) => (
            <div key={doc.id} style={{ marginBottom: "1rem" }}>
              <p>
                <strong>{doc.docType.replace(/_/g, " ")}</strong> — {doc.originalFilename}
              </p>
              <DocumentPreview doc={doc} />
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>Approval decision</h2>
        <p>Approving or declining is separate from — and never grants — tax-exempt status.</p>
        {app.status !== "approved" &&
          app.status !== "declined" &&
          decision === "approved" &&
          !data.documents.some((d) => d.docType === "sellers_permit") && (
            <p role="alert" className="field-error">
              A seller&apos;s permit copy is required before approval. No permit is on file yet — ask the
              applicant to upload one via their status link, then record the decision.
            </p>
          )}
        {app.status === "approved" || app.status === "declined" ? (
          <p>
            Decision recorded: <span className={`badge ${app.status === "approved" ? "badge-ok" : "badge-bad"}`}>{app.status}</span>
            {app.decisionReason && (
              <>
                {" — "}reason: {app.decisionReason}
              </>
            )}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              // Never fire on plain submit (e.g. Enter in a field) — the
              // ConfirmAction button below is the only firing path.
              e.preventDefault();
            }}
          >
            <label htmlFor="decision">Decision</label>
            <select id="decision" value={decision} onChange={(e) => onDecisionChange(e.target.value as ApplicationDecision)}>
              <option value="approved">Approve</option>
              <option value="declined">Decline</option>
              <option value="needs_review">Flag needs review</option>
            </select>

            <label htmlFor="reasonCode">Reason (included in the applicant&apos;s email)</label>
            <select id="reasonCode" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {DECISION_REASONS[decision].map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>

            <label htmlFor="reasonNote">
              Note (optional{reasonCode === "other" ? ", required for “Other”" : ""})
            </label>
            <input
              id="reasonNote"
              type="text"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder={reasonCode === "other" ? "Describe the reason…" : "Anything extra for the record…"}
              required={reasonCode === "other"}
              maxLength={500}
            />

            <div style={{ marginTop: "1rem" }}>
              <ConfirmAction
                label={busy ? "Recording…" : "Record decision"}
                confirmLabel="Confirm — record decision"
                onConfirm={fireDecision}
                disabled={busy}
                danger={decision === "declined"}
                detail={
                  decision === "approved"
                    ? "This will approve the application, create a buyer account, and email the applicant."
                    : decision === "declined"
                      ? "This will decline the application and email the applicant. This cannot be undone here."
                      : "This will flag the application for further review."
                }
              />
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Tax determination</h2>
        <p>
          Independent of the approval decision above. An exempt determination requires evidence — pick one of the
          uploaded documents.
        </p>
        {!app.accountId ? (
          <p>Approve this application first; a tax determination requires an account to exist.</p>
        ) : (
          <form onSubmit={onTaxSubmit}>
            <label htmlFor="taxStatus">Status</label>
            <select id="taxStatus" value={taxStatus} onChange={(e) => setTaxStatus(e.target.value)}>
              <option value="exempt">Exempt</option>
              <option value="taxable">Taxable</option>
            </select>

            <label htmlFor="taxEvidenceKey">Evidence document</label>
            <select id="taxEvidenceKey" value={taxEvidenceKey} onChange={(e) => setTaxEvidenceKey(e.target.value)}>
              <option value="">No document selected</option>
              {data.documents.map((doc) => (
                <option key={doc.id} value={doc.storageKey}>
                  {doc.originalFilename}
                </option>
              ))}
            </select>

            <label htmlFor="taxNotes">Notes</label>
            <textarea id="taxNotes" required value={taxNotes} onChange={(e) => setTaxNotes(e.target.value)} rows={2} />

            <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
              Record determination
            </button>
          </form>
        )}
        {data.taxDeterminations.length > 0 && (
          <>
            <h3>History</h3>
            <ul>
              {data.taxDeterminations.map((d) => (
                <li key={d.id}>
                  {new Date(d.determinedAt).toLocaleString()} — {d.status} — {d.notes}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
