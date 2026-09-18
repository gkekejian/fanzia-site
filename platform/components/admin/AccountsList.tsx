"use client";

import { useEffect, useState, type FormEvent } from "react";

type AccountRow = {
  id: string;
  legalName: string;
  channelType: string;
  taxStatus: string;
  city: string;
  state: string;
  primaryContactName: string;
  primaryContactEmail: string;
  contactCount: number;
  createdAt: string;
};

export function AccountsList() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load(q: string) {
    const res = await fetch(`/api/admin/accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (!res.ok) {
      setError("Could not load accounts.");
      return;
    }
    setAccounts((await res.json()).accounts);
  }

  useEffect(() => {
    load("");
  }, []);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    load(query.trim());
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Buyer accounts</h1>
      <p>Every approved wholesale customer. Open an account to manage its contacts, roles, and sign-in access.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <label htmlFor="acct-q" className="visually-hidden">
          Search accounts
        </label>
        <input id="acct-q" placeholder="Search by business name or email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      {!accounts && <p aria-live="polite">Loading…</p>}
      {accounts && accounts.length === 0 && <p>No buyer accounts yet. Approving an application creates one.</p>}
      {accounts && accounts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Location</th>
              <th scope="col">Tax</th>
              <th scope="col">Contacts</th>
              <th scope="col">Since</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={`/admin/accounts/${a.id}`}>
                    <strong>{a.legalName}</strong>
                  </a>
                  <br />
                  <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{a.primaryContactEmail}</span>
                </td>
                <td>
                  {a.city}, {a.state}
                </td>
                <td>{a.taxStatus}</td>
                <td>{a.contactCount}</td>
                <td style={{ fontSize: "0.85rem" }}>{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
