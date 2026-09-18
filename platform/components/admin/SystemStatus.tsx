"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  checkedAt: string;
  database: { reachable: boolean; error: string | null };
  migrations: {
    inSync: boolean;
    journalEntries: number;
    filesOnDisk: number;
    missingFiles: string[];
    unjournaledFiles: string[];
    note: string | null;
  };
  tableCounts: Record<string, number | string>;
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`badge ${ok ? "badge-ok" : "badge-bad"}`}>{ok ? `${label}: OK` : `${label}: PROBLEM`}</span>;
}

/**
 * Read-only system status: fetches GET /api/admin/health and renders
 * connectivity, migration journal-vs-files, and key table counts.
 */
export function SystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Could not load health data.");
      setHealth(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load health data.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>System status</h1>
      <p style={{ color: "var(--fz-muted)" }}>
        Read-only database health. Refresh re-runs the check.
        <button type="button" className="btn btn-secondary" onClick={load} disabled={refreshing} style={{ marginLeft: "1rem", padding: "0.3rem 0.8rem" }}>
          {refreshing ? "Checking…" : "Re-check"}
        </button>
      </p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!health && !error && <p aria-live="polite">Loading…</p>}

      {health && (
        <>
          <p>
            <StatusBadge ok={health.ok} label="Overall" />{" "}
            <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
              checked {new Date(health.checkedAt).toLocaleString()}
            </span>
          </p>

          <section className="card">
            <h2>Database connectivity</h2>
            <p>
              <StatusBadge ok={health.database.reachable} label="Postgres" />
            </p>
            {health.database.error && <p className="field-error">{health.database.error}</p>}
          </section>

          <section className="card">
            <h2>Migrations</h2>
            <p>
              <StatusBadge ok={health.migrations.inSync} label="Journal vs files" />{" "}
              {health.migrations.journalEntries} journal entries · {health.migrations.filesOnDisk} files on disk
            </p>
            {health.migrations.note && <p className="field-error">{health.migrations.note}</p>}
            {health.migrations.missingFiles.length > 0 && (
              <p className="field-error">Journal entries with no migration file: {health.migrations.missingFiles.join(", ")}</p>
            )}
            {health.migrations.unjournaledFiles.length > 0 && (
              <p className="field-error">Files not in the journal: {health.migrations.unjournaledFiles.join(", ")}</p>
            )}
          </section>

          <section className="card">
            <h2>Key table counts</h2>
            {health.database.reachable ? (
              <table>
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(health.tableCounts).map(([name, n]) => (
                    <tr key={name}>
                      <td style={{ fontFamily: "monospace" }}>{name}</td>
                      <td>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "var(--fz-muted)" }}>Counts unavailable — the database is unreachable.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
