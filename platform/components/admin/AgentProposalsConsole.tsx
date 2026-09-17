"use client";

import { useEffect, useState } from "react";

type Proposal = {
  id: string;
  proposedAction: string;
  payload: Record<string, unknown>;
  rationale: string;
  decision: "pending" | "approved" | "rejected";
  createdAt: string;
};

export function AgentProposalsConsole() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/agent-proposals");
    if (!res.ok) {
      setError("Could not load agent proposals.");
      return;
    }
    setProposals((await res.json()).proposals);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/agent-proposals/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(body.error ?? "Could not record decision.");
      return;
    }
    load();
  }

  const pending = proposals?.filter((p) => p.decision === "pending") ?? [];
  const decided = proposals?.filter((p) => p.decision !== "pending") ?? [];

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>Agent proposals</h1>
      <p>
        Every restricted action attempted by the ai_operator API key lands here instead of executing. Approving a
        proposal runs the original action, attributed to you as the deciding owner.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!proposals && <p aria-live="polite">Loading…</p>}

      <section className="card">
        <h2>Pending ({pending.length})</h2>
        {pending.length === 0 && <p>Nothing pending.</p>}
        {pending.map((p) => (
          <div key={p.id} className="card" style={{ marginBottom: "1rem" }}>
            <p>
              <strong>{p.proposedAction}</strong> — {new Date(p.createdAt).toLocaleString()}
            </p>
            <p>{p.rationale}</p>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", background: "#fafafa", padding: "0.5rem" }}>
              {JSON.stringify(p.payload, null, 2)}
            </pre>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button type="button" className="btn" disabled={busyId === p.id} onClick={() => decide(p.id, "approved")}>
                Approve &amp; execute
              </button>
              <button type="button" className="btn btn-danger" disabled={busyId === p.id} onClick={() => decide(p.id, "rejected")}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Decided</h2>
        {decided.length === 0 && <p>None yet.</p>}
        {decided.length > 0 && (
          <ul>
            {decided.map((p) => (
              <li key={p.id}>
                {p.proposedAction} — <span className={`badge ${p.decision === "approved" ? "badge-ok" : "badge-bad"}`}>{p.decision}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
