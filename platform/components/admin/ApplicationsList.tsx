"use client";

import { useEffect, useState } from "react";

type Application = {
  id: string;
  businessLegalName: string;
  status: string;
  triageScore: number;
  needsReviewReasons: string[];
  contactEmail: string;
  submittedAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  submitted: "badge-warn",
  needs_review: "badge-warn",
  approved: "badge-ok",
  declined: "badge-bad",
  draft: "badge",
};

export function ApplicationsList() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/applications")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load applications.");
        const body = await res.json();
        setApplications(body.applications);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Applications</h1>
      <p>Sorted by triage score — the score only orders this queue, it never decides anything.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!applications && !error && <p aria-live="polite">Loading…</p>}
      {applications && applications.length === 0 && <p>No applications yet.</p>}
      {applications && applications.length > 0 && (
        <table>
          <caption className="visually-hidden">Applications sorted by triage score, highest first</caption>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Contact</th>
              <th scope="col">Status</th>
              <th scope="col">Triage score</th>
              <th scope="col">Submitted</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id}>
                <td>{app.businessLegalName}</td>
                <td>{app.contactEmail}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[app.status] ?? ""}`}>{app.status}</span>
                </td>
                <td>{app.triageScore}</td>
                <td>{app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "—"}</td>
                <td>
                  <a className="btn btn-secondary" href={`/admin/applications/${app.id}`} style={{ padding: "0.3rem 0.8rem" }}>
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
