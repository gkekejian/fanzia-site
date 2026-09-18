"use client";

import { useEffect, useState, type FormEvent } from "react";

type StaffUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "ai_operator";
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export function UsersConsole() {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers((await res.json()).users);
  }

  useEffect(() => {
    load();
  }, []);

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), name: fd.get("name"), role: fd.get("role") }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not send the invite.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    load();
  }

  async function setActive(id: string, active: boolean) {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not update the user.");
      return;
    }
    load();
  }

  async function showSessions(id: string) {
    setSessionsFor(id);
    const res = await fetch(`/api/admin/users/${id}/sessions`);
    if (res.ok) setSessions((await res.json()).sessions);
  }

  async function revokeSessions(userId: string, sessionId?: string) {
    if (!window.confirm(sessionId ? "Revoke this session?" : "Revoke ALL sessions for this user? They will be signed out everywhere.")) return;
    const url = sessionId ? `/api/admin/users/${userId}/sessions?sessionId=${sessionId}` : `/api/admin/users/${userId}/sessions`;
    await fetch(url, { method: "DELETE" });
    showSessions(userId);
  }

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <h1>Users</h1>
      <p>Staff identities: owners (full access) and ai_operator service accounts. Deactivating signs them out everywhere immediately.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2>Invite staff</h2>
        <form onSubmit={onInvite}>
          <label htmlFor="inv-name">Name</label>
          <input id="inv-name" name="name" required maxLength={120} />
          <label htmlFor="inv-email">Email</label>
          <input id="inv-email" name="email" type="email" required />
          <label htmlFor="inv-role">Role</label>
          <select id="inv-role" name="role" defaultValue="owner">
            <option value="owner">Owner — full access, including user management</option>
            <option value="ai_operator">AI operator — everything except user management and audit log</option>
          </select>
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </form>
        <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>The invite arrives as a sign-in link. Owners must set up two-factor authentication after signing in.</p>
      </section>

      <section className="card">
        <h2>Staff</h2>
        {!users && <p aria-live="polite">Loading…</p>}
        {users && (
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last login</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td style={{ fontSize: "0.85rem" }}>{u.email}</td>
                  <td>{u.role === "owner" ? "Owner" : "AI operator"}</td>
                  <td>{u.active ? "Active" : "Deactivated"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem", marginRight: "0.4rem" }} onClick={() => showSessions(u.id)}>
                      Sessions
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.8rem" }}
                      disabled={busy}
                      onClick={() => {
                        if (u.active && !window.confirm(`Deactivate ${u.name}? Their sessions will be revoked immediately.`)) return;
                        setActive(u.id, !u.active);
                      }}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {sessionsFor && (
        <section className="card">
          <h2>Sessions</h2>
          <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem", marginBottom: "0.8rem" }} onClick={() => revokeSessions(sessionsFor)}>
            Revoke all sessions
          </button>
          {!sessions && <p aria-live="polite">Loading…</p>}
          {sessions && sessions.length === 0 && <p>No sessions recorded.</p>}
          {sessions && sessions.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th scope="col">Created</th>
                  <th scope="col">IP</th>
                  <th scope="col">Device</th>
                  <th scope="col">Status</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontSize: "0.85rem" }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td style={{ fontSize: "0.85rem" }}>{s.ip ?? "—"}</td>
                    <td style={{ fontSize: "0.85rem", maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis" }}>{s.userAgent ?? "—"}</td>
                    <td>{s.revokedAt ? "Revoked" : new Date(s.expiresAt) < new Date() ? "Expired" : "Live"}</td>
                    <td>
                      {!s.revokedAt && new Date(s.expiresAt) >= new Date() && (
                        <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem" }} onClick={() => revokeSessions(sessionsFor, s.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button type="button" className="btn btn-secondary" style={{ padding: "0.3rem 0.8rem", marginTop: "0.8rem" }} onClick={() => setSessionsFor(null)}>
            Close
          </button>
        </section>
      )}
    </main>
  );
}
