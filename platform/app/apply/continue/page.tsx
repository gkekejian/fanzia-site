"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

type ResumeData = {
  id: string;
  status: string;
  businessLegalName: string;
  submittedAt: string | null;
  documents: { id: string; docType: string; originalFilename: string; uploadedAt: string }[];
};

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "sellers_permit", label: "Seller's permit" },
  { value: "resale_certificate_cdtfa230", label: "Resale certificate (CDTFA-230)" },
  { value: "resale_certificate_other_state", label: "Resale certificate (other state)" },
  { value: "channel_evidence", label: "Channel evidence" },
  { value: "other", label: "Other" },
];

function ContinueForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [data, setData] = useState<ResumeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    if (!token) {
      setLoadError("Missing link token.");
      return;
    }
    const res = await fetch(`/api/applications/resume?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      setLoadError("This link is invalid or has expired.");
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    setUploadError(null);
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const docType = (form.elements.namedItem("docType") as HTMLSelectElement).value;
    const file = fileInput.files?.[0];
    if (!file) {
      setUploadError("Choose a file first.");
      return;
    }

    const body = new FormData();
    body.set("file", file);
    body.set("docType", docType);

    setUploading(true);
    const res = await fetch(`/api/applications/${data.id}/documents`, {
      method: "POST",
      headers: { "x-resume-token": token },
      body,
    });
    setUploading(false);
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUploadError(resBody.error ?? "Upload failed.");
      return;
    }
    form.reset();
    load();
  }

  if (loadError) {
    return (
      <main className="container">
        <div className="card">
          <p className="field-error" role="alert">
            {loadError}
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="container">
        <div className="card" aria-live="polite">
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <h1>{data.businessLegalName}</h1>
        <p>
          Status: <span className="badge">{data.status}</span>
        </p>
        <p style={{ color: "var(--fz-muted)" }}>
          {data.status === "approved"
            ? "Your application was approved — check your email for sign-in instructions to your wholesale account."
            : data.status === "declined"
              ? "Your application was not approved — check your email for the details."
              : "What's next: our team reviews every application, usually within a few business days. You can upload documents above at any time to strengthen your application. We'll email you when a decision is made."}
        </p>

        <h2>Documents</h2>
        {data.documents.length === 0 ? (
          <p>No documents uploaded yet.</p>
        ) : (
          <ul>
            {data.documents.map((d) => (
              <li key={d.id}>
                {d.originalFilename} — {d.docType}
              </li>
            ))}
          </ul>
        )}

        <h2>Upload a document</h2>
        {uploadError && (
          <p className="field-error" role="alert">
            {uploadError}
          </p>
        )}
        <form onSubmit={onUpload}>
          <label htmlFor="docType">Document type</label>
          <select id="docType" name="docType" required defaultValue="sellers_permit">
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label htmlFor="file">File (PDF, JPEG, PNG, WEBP, or GIF)</label>
          <input id="file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" />

          <button type="submit" className="btn" disabled={uploading} style={{ marginTop: "1rem" }}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ApplyContinuePage() {
  return (
    <Suspense fallback={<main className="container">Loading…</main>}>
      <ContinueForm />
    </Suspense>
  );
}
