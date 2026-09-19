"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import "./AgentChatPanel.css";

type Suggestion = {
  id: string;
  kind: "margin_alert" | "restock_idea" | "market_brief" | "ops_nudge";
  title: string;
  body: string;
  createdAt: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  list_applications: "Looking up applications",
  get_application: "Reading application detail",
  list_products: "Looking up products",
  list_catalog_imports: "Looking up catalog imports",
  list_order_requests: "Looking up order requests",
  list_invoices: "Looking up invoices",
  search_accounts: "Searching accounts",
  list_suggestions: "Reading suggestions",
  approve_application: "Approve application",
  decline_application: "Decline application",
  publish_catalog_import: "Publish catalog import",
};

const KIND_BADGE: Record<Suggestion["kind"], string> = {
  margin_alert: "badge badge-bad",
  restock_idea: "badge badge-warn",
  market_brief: "badge badge-ok",
  ops_nudge: "badge",
};

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  margin_alert: "Margin alert",
  restock_idea: "Restock idea",
  market_brief: "Market brief",
  ops_nudge: "Ops nudge",
};

function toolLabel(type: string): string {
  const name = type.startsWith("tool-") ? type.slice(5) : type;
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function toolName(type: string): string {
  return type.startsWith("tool-") ? type.slice(5) : type;
}

export function AgentChatPanel() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
    transport: new DefaultChatTransport({ api: "/api/admin/agent/chat" }),
  });

  useEffect(() => {
    fetch("/api/admin/agent/status")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setConfigured(!!body.configured);
        setModel(body.model ?? "");
      })
      .catch(() => {
        // Panel stays usable; send attempts will surface the real error.
      });
  }, []);

  const loadSuggestions = useCallback(() => {
    fetch("/api/admin/agent/suggestions")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setSuggestions(body.suggestions ?? []);
      })
      .catch(() => {
        // Suggestions are a nicety — a failed fetch must not break the panel.
      });
  }, []);

  useEffect(() => {
    if (open) loadSuggestions();
  }, [open, loadSuggestions]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const busy = status === "streaming" || status === "submitted";

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <>
      <button type="button" className="fz-agent-fab" onClick={() => setOpen((v) => !v)} aria-label="Open AI operator chat">
        {suggestions.length > 0 && <span className="dot" aria-hidden />}
        AI operator
      </button>

      {open && (
        <section className="fz-agent-panel" aria-label="AI operator chat">
          <header className="fz-agent-header">
            <h2>AI operator</h2>
            {model && <span className="badge">{model}</span>}
            <span className="spacer" />
            <button type="button" className="fz-agent-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
          </header>

          <div className="fz-agent-body" ref={bodyRef}>
            {configured === false ? (
              <div className="fz-agent-notice">
                <strong>AI operator isn&apos;t configured yet.</strong>
                <br />
                Add <code>ANTHROPIC_API_KEY</code> in Vercel → fanzia-platform-staging → Environment Variables, then
                redeploy. The chat will start working immediately — nothing else to change.
              </div>
            ) : (
              <>
                {suggestions.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="linklike fz-agent-suggestion-toggle"
                      onClick={() => setSuggestionsOpen((v) => !v)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        color: "var(--fz-black)",
                        marginBottom: "0.4rem",
                      }}
                    >
                      {suggestionsOpen ? "▾" : "▸"} Latest suggestions ({suggestions.length})
                    </button>
                    {suggestionsOpen &&
                      suggestions.slice(0, 4).map((s) => (
                        <div key={s.id} className="fz-agent-suggestion" style={{ marginBottom: "0.5rem" }}>
                          <span className={KIND_BADGE[s.kind]}>{KIND_LABEL[s.kind]}</span>
                          <h4>{s.title}</h4>
                          <p>{s.body}</p>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => setInput(`Tell me more about this: ${s.title}`)}
                          >
                            Ask about this →
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                {messages.length === 0 && (
                  <div className="fz-agent-msg assistant">
                    Ask me about applications, orders, invoices, or the catalog — e.g. “What applications are waiting?”
                    or “What&apos;s new this week?” Anything that changes data will ask your approval first.
                  </div>
                )}

                {messages.map((message) => (
                  <div key={message.id} style={{ display: "contents" }}>
                    {message.parts.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          <div
                            key={`${message.id}-${i}`}
                            className={`fz-agent-msg ${message.role === "user" ? "user" : "assistant"}`}
                          >
                            {part.text}
                          </div>
                        );
                      }
                      if (part.type.startsWith("tool-")) {
                        const name = toolName(part.type);
                        const state = (part as { state?: string }).state;
                        const key = `${message.id}-${i}`;
                        if (state === "approval-requested") {
                          const approval = (part as { approval: { id: string } }).approval;
                          const inputArgs = (part as { input?: unknown }).input;
                          return (
                            <div key={key} className="fz-agent-approval" role="alertdialog" aria-label="Approval needed">
                              <h3>⚠ Approval needed</h3>
                              <div>
                                <strong>{TOOL_LABELS[name] ?? name}</strong>
                              </div>
                              <pre>{JSON.stringify(inputArgs ?? {}, null, 2)}</pre>
                              <div className="actions">
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => addToolApprovalResponse({ id: approval.id, approved: true })}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => addToolApprovalResponse({ id: approval.id, approved: false })}
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          );
                        }
                        if (state === "output-denied") {
                          return (
                            <div key={key} className="fz-agent-tool">
                              ✕ {toolLabel(part.type)} — declined by you.
                            </div>
                          );
                        }
                        if (state === "output-error") {
                          return (
                            <div key={key} className="fz-agent-tool" style={{ color: "var(--fz-red)" }}>
                              ⚠ {toolLabel(part.type)} failed: {String((part as { errorText?: string }).errorText ?? "error").slice(0, 200)}
                            </div>
                          );
                        }
                        if (state === "input-streaming" || state === "input-available") {
                          return (
                            <div key={key} className="fz-agent-tool">
                              ⚙︎ {toolLabel(part.type)}…
                            </div>
                          );
                        }
                        return null;
                      }
                      return null;
                    })}
                  </div>
                ))}

                {busy && <div className="fz-agent-tool">⚙︎ thinking…</div>}

                {error && (
                  <div className="fz-agent-error">
                    The agent request failed{error.message ? `: ${error.message.slice(0, 200)}` : "."} Try again — if it
                    keeps failing, check the function logs in Vercel.
                  </div>
                )}
              </>
            )}
          </div>

          {configured !== false && (
            <>
              <div className="fz-agent-status">
                {busy ? "Working…" : "Ask anything. Data-changing actions ask your approval first."}
              </div>
              <form className="fz-agent-input" onSubmit={submit}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about applications, orders, catalog…"
                  aria-label="Message the AI operator"
                  disabled={busy}
                />
                <button type="submit" className="btn" disabled={busy || !input.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
