"use client";

import { useEffect, useState } from "react";
import type { HealthReport } from "@/lib/ops/health";

const LABEL = { ok: "OK", warn: "Check", fail: "Problem" } as const;

/**
 * Everything that can silently go wrong, in plain words, with the fix
 * next to it. Same checks power the Today page, the weekly digest, and the
 * public uptime endpoint (/api/public/health).
 */
export function SystemStatus() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Could not load system status.");
      setReport(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load system status.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const order = { fail: 0, warn: 1, ok: 2 } as const;
  const checks = report ? [...report.checks].sort((a, b) => order[a.status] - order[b.status]) : [];

  return (
    <main className="container" style={{ maxWidth: "860px" }}>
      <div className="page-head">
        <div>
          <h1>System status</h1>
          <p className="page-sub">
            {report
              ? report.status === "ok"
                ? "Everything is healthy."
                : `${report.checks.filter((c) => c.status === "fail").length} problem(s), ${report.checks.filter((c) => c.status === "warn").length} thing(s) to check.`
              : "Checking…"}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={busy}>
          {busy ? "Checking…" : "Re-check"}
        </button>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <section className="card">
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.key}>
                <span className={`status status-${c.status}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {c.label}: {LABEL[c.status]}
                </span>
                <span>{c.detail}</span>
                {c.fix && c.status !== "ok" && <span className="check-fix">Fix: {c.fix}</span>}
              </li>
            ))}
          </ul>
          <p className="setting-help" style={{ marginTop: "0.75rem" }}>
            Checked {new Date(report.checkedAt).toLocaleString()}. For alerts when you&rsquo;re not looking, point a free uptime
            monitor at <code>/api/public/health</code>: it returns 503 when the database is down or the daily run stops.
          </p>
        </section>
      )}
    </main>
  );
}
