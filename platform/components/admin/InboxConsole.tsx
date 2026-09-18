"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "./ConfirmAction";

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  source: string;
  status: string;
  createdAt: string;
};

type Reply = {
  id: string;
  body: string;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  new: "badge-warn",
  open: "badge",
  replied: "badge-ok",
  closed: "badge",
};

const STATUSES = ["new", "open", "replied", "closed"] as const;

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function InboxConsole() {
  const [messages, setMessages] = useState<ContactMessage[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ message: ContactMessage; replies: Reply[] } | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyState, setReplyState] = useState<"idle" | "sending" | "error">("idle");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);

  const loadList = useCallback(() => {
    const qs = filter ? `?status=${encodeURIComponent(filter)}` : "";
    fetch(`/api/admin/contact-messages${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load the inbox.");
        const body = await res.json();
        setMessages(body.messages);
      })
      .catch((err) => setError(err.message));
  }, [filter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function openThread(id: string) {
    setSelectedId(id);
    setThreadLoading(true);
    setThread(null);
    try {
      const res = await fetch(`/api/admin/contact-messages/${id}`);
      if (!res.ok) throw new Error("Could not load this message.");
      setThread(await res.json());
      setReplyBody("");
      setReplyError(null);
      setReplyState("idle");
    } catch (err) {
      setThread({ message: null as unknown as ContactMessage, replies: [] });
      setReplyError(err instanceof Error ? err.message : "Could not load this message.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !replyBody.trim()) return;
    setReplyState("sending");
    setReplyError(null);
    setReplyNotice(null);
    try {
      const res = await fetch(`/api/admin/contact-messages/${selectedId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Could not send the reply.");
      }
      setReplyBody("");
      setReplyState("idle");
      if (body.emailSent === false) {
        // The reply is stored (and the thread marked "replied"), but the
        // email to the visitor did not go out — say so plainly instead of
        // leaving staff to assume it was delivered.
        setReplyNotice(
          "Reply stored, but the email to the visitor was not delivered. Follow up another way and check the server logs.",
        );
      }
      openThread(selectedId);
      loadList();
    } catch (err) {
      setReplyState("error");
      setReplyError(err instanceof Error ? err.message : "Could not send the reply.");
    }
  }

  async function changeStatus(status: string) {
    if (!selectedId) return;
    const res = await fetch(`/api/admin/contact-messages/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setReplyError(body.error || "Could not update status.");
      return;
    }
    openThread(selectedId);
    loadList();
  }

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Website inbox</h1>
      <p>Contact-form submissions from fanzia.io. Read and reply here — replies go to the visitor by email.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div style={{ margin: "1rem 0" }}>
        <label>
          Filter by status{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!messages && !error && <p aria-live="polite">Loading…</p>}
      {messages && messages.length === 0 && <p>No messages yet.</p>}
      {messages && messages.length > 0 && (
        <table>
          <caption className="visually-hidden">Website contact messages, newest first</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Subject</th>
              <th scope="col">Status</th>
              <th scope="col">Received</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}
                  <br />
                  <span style={{ color: "var(--fz-muted)" }}>{m.email}</span>
                </td>
                <td>{m.subject || "—"}</td>
                <td>
                  <span className={STATUS_BADGE[m.status] || "badge"}>{m.status}</span>
                </td>
                <td>{formatDate(m.createdAt)}</td>
                <td>
                  <button type="button" className="btn btn-secondary" onClick={() => openThread(m.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedId && (
        <section aria-label="Message thread" style={{ marginTop: "2rem", borderTop: "1px solid var(--fz-border)", paddingTop: "1.5rem" }}>
          {threadLoading && <p aria-live="polite">Loading thread…</p>}
          {thread?.message && (
            <>
              <h2>
                {thread.message.subject || "Message"} — {thread.message.name}
              </h2>
              <p style={{ color: "var(--fz-muted)" }}>
                {thread.message.email} · {formatDate(thread.message.createdAt)}
              </p>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>{thread.message.message}</blockquote>

              {thread.replies.length > 0 && (
                <>
                  <h3>Replies</h3>
                  <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>
                    Replies are stored here and emailed to the visitor. Email delivery is
                    best-effort — a failed send is logged on the server, and the reply below
                    does not prove it was delivered.
                  </p>
                  {thread.replies.map((r) => (
                    <div key={r.id} style={{ marginBottom: "1rem" }}>
                      <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{formatDate(r.createdAt)}</p>
                      <blockquote style={{ whiteSpace: "pre-wrap" }}>{r.body}</blockquote>
                    </div>
                  ))}
                </>
              )}

              <h3>Reply</h3>
              {replyError && (
                <p className="field-error" role="alert">
                  {replyError}
                </p>
              )}
              {replyNotice && (
                <p role="alert" style={{ color: "var(--fz-warn, #7a4a00)" }}>
                  {replyNotice}
                </p>
              )}
              <label>
                Your reply (emailed to {thread.message.email})
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={5}
                  style={{ width: "100%" }}
                />
              </label>
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                <ConfirmAction
                  label={replyState === "sending" ? "Sending…" : "Send reply"}
                  confirmLabel="Confirm — send reply"
                  onConfirm={sendReply}
                  disabled={replyState === "sending" || !replyBody.trim()}
                  detail={`This emails the visitor at ${thread.message.email}.`}
                />
                {STATUSES.filter((s) => s !== thread.message.status).map((s) => (
                  <button key={s} type="button" className="btn btn-secondary" onClick={() => changeStatus(s)}>
                    Mark {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
