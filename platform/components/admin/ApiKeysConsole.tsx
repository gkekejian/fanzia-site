"use client";

import { useEffect, useState, type FormEvent } from "react";

type ApiKeyRow = {
  id: string;
  keyPrefix: string;
  scopes: string[];
  userName: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type AiOperator = { id: string; name: string; email: string };

export function ApiKeysConsole() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [operators, setOperators] = useState<AiOperator[] | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [keysRes, opsRes] = await Promise.all([fetch("/api/admin/api-keys"), fetch("/api/admin/ai-operators")]);
    if (keysRes.ok) setKeys((await keysRes.json()).apiKeys);
    if (opsRes.ok) setOperators((await opsRes.json()).aiOperators);
  }

  useEffect(() => {
    load();
  }, []);

  async function onIssue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setRawKey(null);
    const userId = new FormData(e.currentTarget).get("userId");
    setBusy(true);
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, scopes: ["read", "admin:non-restricted"] }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not issue key.");
      return;
    }
    setRawKey(body.rawKey);
    load();
  }

  async function onRevoke(id: string) {
    setBusy(true);
    await fetch(`/api/admin/api-keys/${id}/revoke`, { method: "POST" });
    setBusy(false);
    load();
  }

  return (
    <main className="container" style={{ maxWidth: "900px" }}>
      <h1>API keys</h1>
      <p>ai_operator service-account credentials. A raw key is shown exactly once, at issuance — never again.</p>

      {rawKey && (
        <div className="card" role="alert" style={{ borderColor: "var(--fz-red)" }}>
          <strong>New API key (copy it now — it will not be shown again):</strong>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{rawKey}</pre>
        </div>
      )}

      <section className="card">
        <h2>Issue a new key</h2>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {operators && operators.length > 0 ? (
          <form onSubmit={onIssue}>
            <label htmlFor="userId">Service account</label>
            <select id="userId" name="userId" required>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.name} ({op.email})
                </option>
              ))}
            </select>
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
              Issue key
            </button>
          </form>
        ) : (
          <p>No ai_operator service accounts exist yet. Seed one with db/seed.ts.</p>
        )}
      </section>

      <section className="card">
        <h2>Existing keys</h2>
        {!keys && <p aria-live="polite">Loading…</p>}
        {keys && keys.length === 0 && <p>No keys issued yet.</p>}
        {keys && keys.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Prefix</th>
                <th scope="col">Scopes</th>
                <th scope="col">Last used</th>
                <th scope="col">Status</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.userName}</td>
                  <td>
                    <code>{k.keyPrefix}…</code>
                  </td>
                  <td>{k.scopes.join(", ")}</td>
                  <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                  <td>
                    <span className={`badge ${k.revokedAt ? "badge-bad" : "badge-ok"}`}>
                      {k.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td>
                    {!k.revokedAt && (
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onRevoke(k.id)} style={{ padding: "0.3rem 0.8rem" }}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
