"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ConfirmAction } from "./ConfirmAction";

type Invite = {
  id: string;
  email: string;
  name: string;
  note: string | null;
  codeHint: string;
  status: "active" | "used" | "expired" | "revoked";
  expiresAt: string;
  usedAt: string | null;
  usedApplicationId: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<Invite["status"], string> = {
  active: "badge-ok",
  used: "badge",
  expired: "badge-warn",
  revoked: "badge",
};

export type CreatedInvite = { link: string; code: string; email: string };

/**
 * Create one invite and show its link once. Shared by the Applications
 * page and the inbox ("Send invite" on a waitlist message).
 */
export function InviteForm({
  defaultName = "",
  defaultEmail = "",
  sourceMessageId = null,
  onCreated,
}: {
  defaultName?: string;
  defaultEmail?: string;
  sourceMessageId?: string | null;
  onCreated?: (created: CreatedInvite) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, note, sourceMessageId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the invite.");
      const result = { link: body.link as string, code: body.code as string, email: body.invite.email as string };
      setCreated(result);
      onCreated?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="card" role="status">
        <p style={{ marginTop: 0 }}>
          <strong>Invite emailed to {created.email}.</strong> This link is shown once. Copy it now if you also want to
          text it:
        </p>
        <p>
          <code style={{ wordBreak: "break-all" }}>{created.link}</code>
        </p>
        <p style={{ marginBottom: 0 }}>
          Code: <code>{created.code}</code>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.5rem", maxWidth: "520px" }}>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Name (person or business)
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <label>
        Email (the application must use this email)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} />
      </label>
      <label>
        Note for yourself (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      <div>
        <button type="submit" className="btn" disabled={busy || !name.trim() || !email.trim()}>
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}

/** Applications page section: send invites and see every invite's status. */
export function InvitesPanel() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/invites")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load invites.");
        setInvites((await res.json()).invites);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    const res = await fetch(`/api/admin/invites/${id}/revoke`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not revoke the invite.");
    }
    load();
  }

  return (
    <section aria-labelledby="invites-heading" style={{ margin: "1.5rem 0" }}>
      <h2 id="invites-heading">Invites</h2>
      <p style={{ marginTop: 0 }}>
        Let one person apply while applications are closed. Each invite works once, only with the invited email, and
        expires (Settings → Applications). They still go through review. You can also send an invite straight from a
        waitlist message in the Inbox.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {showForm ? (
        <div style={{ marginBottom: "1rem" }}>
          <InviteForm key={formKey} onCreated={() => load()} />
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: "0.5rem" }}
            onClick={() => {
              setFormKey((k) => k + 1);
              setShowForm(false);
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setShowForm(true)} style={{ marginBottom: "1rem" }}>
          New invite
        </button>
      )}
      {invites && invites.length === 0 && <p>No invites yet.</p>}
      {invites && invites.length > 0 && (
        <table>
          <caption className="visually-hidden">Invites, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Code ends</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id}>
                <td>
                  {inv.name}
                  {inv.note && <div style={{ fontSize: "0.85em", color: "var(--fz-muted)" }}>{inv.note}</div>}
                </td>
                <td>{inv.email}</td>
                <td>
                  <code>…{inv.codeHint}</code>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[inv.status]}`}>{inv.status}</span>
                  {inv.usedApplicationId && (
                    <>
                      {" "}
                      <a href={`/admin/applications/${inv.usedApplicationId}`}>application</a>
                    </>
                  )}
                </td>
                <td>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                <td>
                  {inv.status === "active" && (
                    <ConfirmAction
                      label="Revoke"
                      confirmLabel="Confirm — revoke"
                      danger
                      onConfirm={() => revoke(inv.id)}
                      detail="The code stops working immediately."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
