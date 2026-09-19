"use client";

import { useEffect, useState } from "react";
import { AgentChatPanel } from "./admin/AgentChatPanel";

export function AdminNav({ userName }: { userName: string }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Lightweight poll for the bell badge: unread count only.
    fetch("/api/admin/notifications?unread=1&limit=1")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setUnreadCount(body.unreadCount ?? 0);
      })
      .catch(() => {
        // The bell is decorative — a failed count fetch must not break nav.
      });
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      <a href="/admin/applications">Applications</a>
      <a href="/admin/inbox">Inbox</a>
      <a href="/admin/notifications">
        🔔 Notifications
        {unreadCount > 0 && (
          <span
            className="badge-warn"
            style={{ marginLeft: "0.35rem", fontSize: "0.75rem" }}
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </a>
      <a href="/admin/accounts">Accounts</a>
      <a href="/admin/catalog-imports">Catalog imports</a>
      <a href="/admin/agent-proposals">Agent proposals</a>
      <a href="/admin/api-keys">API keys</a>
      <a href="/admin/users">Users</a>
      <a href="/admin/order-requests">Order requests</a>
      <a href="/admin/nayax">Vending</a>
      <a href="/admin/invoices">Invoices</a>
      <a href="/admin/accounting">Accounting</a>
      <a href="/admin/po-packs">PO packs</a>
      <a href="/admin/system-status">System status</a>
      <span style={{ marginLeft: "auto", color: "var(--fz-muted)" }}>{userName}</span>
      <button type="button" className="btn btn-secondary" onClick={logout} style={{ padding: "0.3rem 0.8rem" }}>
        Log out
      </button>
      <AgentChatPanel />
    </nav>
  );
}
