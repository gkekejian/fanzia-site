"use client";

import { useEffect, useState, type FormEvent } from "react";

type CatalogImport = {
  id: string;
  originalFilename: string;
  fileFormat: string;
  status: string;
  rowCount: number;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  staged: "badge-warn",
  approved: "badge-warn",
  published: "badge-ok",
  rejected: "badge-bad",
};

export function CatalogImportsList() {
  const [imports, setImports] = useState<CatalogImport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/catalog-imports");
    if (!res.ok) {
      setError("Could not load catalog imports.");
      return;
    }
    const body = await res.json();
    setImports(body.imports);
  }

  useEffect(() => {
    load();
  }, []);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/admin/catalog-imports", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) {
      setUploadMessage(body.error ?? "Upload failed.");
      return;
    }
    setUploadMessage(`Staged ${body.import.rowCount} rows. Review the diff before approving.`);
    form.reset();
    load();
  }

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <h1>Catalog imports</h1>
      <p>
        Upload a CSV or XLSX supplier price/availability file. Nothing goes live until you review the diff, approve
        it, and publish.
      </p>
      <section className="card">
        <h2>Upload a file</h2>
        <form onSubmit={onUpload}>
          <label htmlFor="file">CSV or XLSX file</label>
          <input id="file" name="file" type="file" accept=".csv,.xlsx" required />
          <button type="submit" className="btn" disabled={uploading} style={{ marginTop: "1rem" }}>
            {uploading ? "Uploading…" : "Upload and stage"}
          </button>
        </form>
        {uploadMessage && <p role="status">{uploadMessage}</p>}
      </section>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!imports && !error && <p aria-live="polite">Loading…</p>}
      {imports && imports.length === 0 && <p>No imports yet.</p>}
      {imports && imports.length > 0 && (
        <table>
          <caption className="visually-hidden">Catalog imports</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Status</th>
              <th scope="col">Rows</th>
              <th scope="col">Uploaded</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {imports.map((imp) => (
              <tr key={imp.id}>
                <td>
                  {imp.originalFilename} <span style={{ color: "var(--fz-muted)" }}>({imp.fileFormat})</span>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[imp.status] ?? ""}`}>{imp.status}</span>
                </td>
                <td>{imp.rowCount}</td>
                <td>{new Date(imp.createdAt).toLocaleString()}</td>
                <td>
                  <a className="btn btn-secondary" href={`/admin/catalog-imports/${imp.id}`} style={{ padding: "0.3rem 0.8rem" }}>
                    Review
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
