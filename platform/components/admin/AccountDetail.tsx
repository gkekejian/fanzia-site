"use client";

import { useEffect, useState, type FormEvent } from "react";

type Contact = {
  id: string;
  name: string;
  email: string;
  roleOnAccount: string;
  active: boolean;
  createdAt: string;
};

type AccountDetail = {
  id: string;
  legalName: string;
  channelType: string;
  taxStatus: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryContactName: string;
  primaryContactEmail: string;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  primary: "Primary — full control, manages contacts",
  purchaser: "Purchaser — builds drafts and orders",
  viewer: "Viewer — read-only",
};

export function AccountDetail({ accountId }: { accountId: string }) {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [taxNotes, setTaxNotes] = useState<{ status: string; notes: string; determinedAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/admin/accounts/${accountId}`);
    if (!res.ok) {
      setError("Could not load this account.");
      return;
    }
    const body = await res.json();
    setAccount(body.account);
    setContacts(body.contacts);
    setTaxNotes(body.taxDeterminations);
  }

  useEffect(() => {
    load();
  }, [accountId]);

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await fetch(`/api/admin/accounts/${accountId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), role: fd.get("role") }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not invite the contact.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    load();
  }

  async function updateContact(contactId: string, patch: { role?: string; active?: boolean }, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/accounts/${accountId}/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not update the contact.");
      return;
    }
    load();
  }

  if (!account) {
    return (
      <main className="container" style={{ maxWidth: "1000px" }}>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : (
          <p aria-live="polite">Loading…</p>
        )}
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: "1000px" }}>
      <p>
        <a href="/admin/accounts">← All accounts</a>
      </p>
      <h1>{account.legalName}</h1>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2>Account</h2>
        <p>
          {account.addressLine1}
          {account.addressLine2 ? `, ${account.addressLine2}` : ""}, {account.city}, {account.state} {account.postalCode}, {account.country}
        </p>
        <p>
          Channel: {account.channelType} · Tax status: <strong>{account.taxStatus}</strong>
        </p>
        {taxNotes.length > 0 && (
          <ul>
            {taxNotes.map((t, i) => (
              <li key={i} style={{ fontSize: "0.85rem" }}>
                {new Date(t.determinedAt).toLocaleDateString()}: {t.status} — {t.notes}
              </li>
            ))}
          </ul>
        )}
        <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>Customer since {new Date(account.createdAt).toLocaleDateString()}</p>
      </section>

      <section className="card">
        <h2>Contacts</h2>
        {!contacts && <p aria-live="polite">Loading…</p>}
        {contacts && (
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td style={{ fontSize: "0.85rem" }}>{c.email}</td>
                  <td>
                    <label htmlFor={`role-${c.id}`} className="visually-hidden">
                      Role for {c.name}
                    </label>
                    <select
                      id={`role-${c.id}`}
                      value={["primary", "purchaser", "viewer"].includes(c.roleOnAccount) ? c.roleOnAccount : "viewer"}
                      disabled={busy}
                      onChange={(e) => updateContact(c.id, { role: e.target.value })}
                    >
                      <option value="primary">Primary</option>
                      <option value="purchaser">Purchaser</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td>{c.active ? "Active" : "Disabled"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.8rem" }}
                      disabled={busy}
                      onClick={() =>
                        updateContact(
                          c.id,
                          { active: !c.active },
                          c.active ? `Disable ${c.name}? They will be signed out and cannot sign back in.` : undefined,
                        )
                      }
                    >
                      {c.active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--fz-muted)" }}>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <div key={k}>{v}</div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Invite a contact</h2>
        <form onSubmit={onInvite}>
          <label htmlFor="c-name">Name</label>
          <input id="c-name" name="name" required maxLength={120} />
          <label htmlFor="c-email">Email</label>
          <input id="c-email" name="email" type="email" required />
          <label htmlFor="c-role">Role</label>
          <select id="c-role" name="role" defaultValue="purchaser">
            <option value="primary">Primary — full control, manages contacts</option>
            <option value="purchaser">Purchaser — builds drafts and orders</option>
            <option value="viewer">Viewer — read-only</option>
          </select>
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: "1rem" }}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>
    </main>
  );
}
