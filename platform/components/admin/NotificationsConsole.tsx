"use client";

import { useCallback, useEffect, useState } from "react";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: "info" | "warning";
  readAt: string | null;
  createdAt: string;
  linkPath: string | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

/**
 * Owner notification center: newest first, unread highlighted, each item
 * links to the record it describes (application / order request /
 * allocation round / invoice). Mark-read is instant and optimistic.
 */
export function NotificationsConsole() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const load = useCallback(() => {
    const qs = showUnreadOnly ? "?unread=1" : "";
    fetch(`/api/admin/notifications${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load notifications.");
        const body = await res.json();
        setItems(body.notifications);
        setUnreadCount(body.unreadCount ?? 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load notifications."));
  }, [showUnreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    // Optimistic: the row is idempotent server-side, so a failed request
    // just leaves the item unread and shows the error.
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, { method: "PATCH" });
      if (!res.ok) throw new Error("Could not mark the notification read.");
    } catch {
      load();
    }
  }

  async function markAllRead() {
    try {
      const res = await fetch("/api/admin/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("Could not mark all notifications read.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark all notifications read.");
    }
  }

  return (
    <main style={{ maxWidth: "56rem", margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        {unreadCount > 0 && <span className="badge-warn">{unreadCount} unread</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowUnreadOnly((v) => !v)}
            style={{ padding: "0.3rem 0.8rem" }}
          >
            {showUnreadOnly ? "Show all" : "Unread only"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            style={{ padding: "0.3rem 0.8rem" }}
          >
            Mark all read
          </button>
        </span>
      </div>

      {error && <p style={{ color: "var(--fz-danger, #b3261e)" }}>{error}</p>}
      {items === null && <p>Loading…</p>}
      {items !== null && items.length === 0 && (
        <p style={{ color: "var(--fz-muted)" }}>
          {showUnreadOnly ? "No unread notifications." : "No notifications yet. New business events will appear here."}
        </p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
        {items?.map((n) => (
          <li
            key={n.id}
            style={{
              border: "1px solid var(--fz-border, #e2e2e2)",
              borderRadius: "0.5rem",
              padding: "0.9rem 1rem",
              background: n.readAt ? "transparent" : "var(--fz-highlight, #fff8e6)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              {!n.readAt && (
                <span
                  aria-label="unread"
                  title="Unread"
                  style={{
                    width: "0.55rem",
                    height: "0.55rem",
                    borderRadius: "50%",
                    background: "var(--fz-accent, #1a73e8)",
                    flexShrink: 0,
                    alignSelf: "center",
                  }}
                />
              )}
              <strong style={{ flexGrow: 1 }}>
                {n.linkPath ? <a href={n.linkPath}>{n.title}</a> : n.title}
              </strong>
              {n.severity === "warning" && <span className="badge-bad">needs attention</span>}
            </div>
            <p style={{ margin: "0.4rem 0", whiteSpace: "pre-line" }}>{n.body}</p>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                color: "var(--fz-muted)",
                fontSize: "0.85rem",
              }}
            >
              <span>{formatDate(n.createdAt)}</span>
              {n.actorEmail && <span>by {n.actorEmail}</span>}
              {!n.readAt && (
                <button type="button" className="link-btn" onClick={() => markRead(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
