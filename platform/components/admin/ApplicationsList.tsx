"use client";

import { useEffect, useState } from "react";
import { TRIAGE_MAX_SCORE, triageBand } from "@/lib/applications/triage";

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
  const [portalOpen, setPortalOpen] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    fetch("/api/admin/applications")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load applications.");
        const body = await res.json();
        setApplications(body.applications);
      })
      .catch((err) => setError(err.message));
    fetch("/api/admin/settings/applications")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setPortalOpen(body.open === true);
      })
      .catch(() => {});
  }, []);

  async function togglePortal() {
    if (portalOpen === null || toggling) return;
    setToggling(true);
    try {
      const res = await fetch("/api/admin/settings/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ open: !portalOpen }),
      });
      if (!res.ok) throw new Error("Could not update the portal setting.");
      const body = await res.json();
      setPortalOpen(body.open === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the portal setting.");
    } finally {
      setToggling(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Applications</h1>
      <section
        aria-label="Application portal status"
        style={{
          border: "1px solid var(--border, #e2e2e2)",
          borderRadius: "8px",
          padding: "12px 16px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "220px" }}>
          <strong>Application portal: </strong>
          {portalOpen === null ? (
            "Loading…"
          ) : portalOpen ? (
            <span className="badge badge-ok">Open — accepting new applications</span>
          ) : (
            <span className="badge badge-warn">Closed — not accepting new applications</span>
          )}
          <p style={{ margin: "6px 0 0", fontSize: "0.9em" }}>
            Closing stops new applications at /apply. In-flight applications (status links, document
            uploads, this queue) keep working.
          </p>
        </div>
        <button type="button" onClick={togglePortal} disabled={portalOpen === null || toggling}>
          {toggling ? "Saving…" : portalOpen ? "Close portal" : "Reopen portal"}
        </button>
      </section>
      <p>
        Review flags: <strong>0 of {TRIAGE_MAX_SCORE}</strong> = clear ·{" "}
        <strong>1 of {TRIAGE_MAX_SCORE}</strong> = one thing to verify ·{" "}
        <strong>2–{TRIAGE_MAX_SCORE} of {TRIAGE_MAX_SCORE}</strong> = check before approving. Higher means more to
        verify, not a better applicant — flags only order this queue, they never approve or decline anyone.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!applications && !error && <p aria-live="polite">Loading…</p>}
      {applications && applications.length === 0 && <p>No applications yet.</p>}
      {applications && applications.length > 0 && (
        <table>
          <caption className="visually-hidden">Applications sorted by review flags, highest first</caption>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Contact</th>
              <th scope="col">Status</th>
              <th scope="col">Review flags</th>
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
                <td>
                  {(() => {
                    const band = triageBand(app.triageScore);
                    const toneClass = band.tone === "ok" ? "badge-ok" : band.tone === "warn" ? "badge-warn" : "badge-bad";
                    return (
                      <span className={`badge ${toneClass}`} title={band.label}>
                        {app.triageScore} of {TRIAGE_MAX_SCORE} · {band.label}
                      </span>
                    );
                  })()}
                </td>
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
