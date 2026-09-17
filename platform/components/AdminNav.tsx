"use client";

export function AdminNav({ userName }: { userName: string }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      <a href="/admin/applications">Applications</a>
      <a href="/admin/agent-proposals">Agent proposals</a>
      <a href="/admin/api-keys">API keys</a>
      <span style={{ marginLeft: "auto", color: "var(--fz-muted)" }}>{userName}</span>
      <button type="button" className="btn btn-secondary" onClick={logout} style={{ padding: "0.3rem 0.8rem" }}>
        Log out
      </button>
    </nav>
  );
}
