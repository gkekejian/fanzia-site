"use client";

export function MemberNav({ contactName }: { contactName: string }) {
  async function logout() {
    await fetch("/api/buyer/auth/logout", { method: "POST" });
    window.location.href = "/member/login";
  }

  return (
    <nav className="admin-nav" aria-label="Buyer navigation">
      <a href="/member/catalog">Catalog</a>
      <a href="/member/draft-request">Draft request</a>
      <span style={{ marginLeft: "auto", color: "var(--fz-muted)" }}>{contactName}</span>
      <button type="button" className="btn btn-secondary" onClick={logout} style={{ padding: "0.3rem 0.8rem" }}>
        Log out
      </button>
    </nav>
  );
}
