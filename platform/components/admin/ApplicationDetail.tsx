"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  DECISION_REASONS,
  defaultReasonCode,
  type ApplicationDecision,
} from "@/lib/applications/decisionReasons";

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
    status: string;
    accountId: string | null;
    channelType: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    sellersPermitNumber: string | null;
    channelEvidenceUrl: string | null;
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

  async function onDecide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
          <dt>Contact</dt>
          <dd>
            {app.contactName} — {app.contactEmail} {app.contactPhone ? `— ${app.contactPhone}` : ""}
          </dd>
          <dt>Address</dt>
          <dd>
            {app.addressLine1}, {app.city}, {app.state} {app.postalCode}
          </dd>
          <dt>Seller&apos;s permit</dt>
          <dd>{app.sellersPermitNumber || "Not provided"}</dd>
          <dt>Channel evidence</dt>
          <dd>{app.channelEvidenceUrl || "Not provided"}</dd>
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
          <form onSubmit={onDecide}>
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

            <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
              {busy ? "Recording…" : "Record decision"}
            </button>
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
