"use client";

export function AdminNav({ userName }: { userName: string }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      <a href="/admin/applications">Applications</a>
      <a href="/admin/inbox">Inbox</a>
      <a href="/admin/accounts">Accounts</a>
      <a href="/admin/catalog-imports">Catalog imports</a>
      <a href="/admin/agent-proposals">Agent proposals</a>
      <a href="/admin/api-keys">API keys</a>
      <a href="/admin/users">Users</a>
      <a href="/admin/order-requests">Order requests</a>
      <a href="/admin/invoices">Invoices</a>
      <a href="/admin/accounting">Accounting</a>
      <span style={{ marginLeft: "auto", color: "var(--fz-muted)" }}>{userName}</span>
      <button type="button" className="btn btn-secondary" onClick={logout} style={{ padding: "0.3rem 0.8rem" }}>
        Log out
      </button>
    </nav>
  );
}
