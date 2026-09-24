"use client";

import { useEffect, useMemo, useState } from "react";
import type { SettingDef, SettingGroup } from "@/lib/config";

type Values = Record<string, boolean | number | string>;
const GROUP_ORDER: SettingGroup[] = ["Ordering", "Automation", "Applications", "Notifications", "Modules"];
const GROUP_INTRO: Record<SettingGroup, string> = {
  Ordering: "What buyers can order and when. Enforced by the server, shown to buyers automatically.",
  Automation: "How much runs without you. Every automatic step is still audit-logged.",
  Applications: "Whether new buyers can apply or go to the waitlist.",
  Notifications: "How much email you get. The in-app bell always has everything.",
  Modules: "Turn off what you don't use: it disappears from the menu, its API, and its scheduled jobs.",
};

function toDisplay(def: SettingDef, v: boolean | number | string): string | boolean {
  if (def.type === "money") return ((v as number) / 100).toFixed(2);
  if (def.type === "bps") return ((v as number) / 100).toString();
  return v as string | boolean;
}

function fromDisplay(def: SettingDef, raw: string | boolean): boolean | number | string {
  if (def.type === "boolean") return raw as boolean;
  if (def.type === "money") return Math.round(Number(raw) * 100);
  if (def.type === "bps") return Math.round(Number(raw) * 100);
  if (def.type === "integer") return Math.round(Number(raw));
  return raw as string;
}

/**
 * Every business knob on one page, generated from lib/config.ts. Edits are
 * staged locally and saved together (validated all-or-nothing, audited).
 */
export function SettingsConsole() {
  const [defs, setDefs] = useState<SettingDef[] | null>(null);
  const [saved, setSaved] = useState<Values>({});
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [digestMsg, setDigestMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load settings.");
        const body = await res.json();
        setDefs(body.definitions);
        setSaved(body.values);
      })
      .catch((e) => setStatus({ kind: "error", text: e.message }));
  }, []);

  const changes = useMemo(() => {
    if (!defs) return {};
    const out: Record<string, boolean | number | string> = {};
    for (const [key, raw] of Object.entries(draft)) {
      const def = defs.find((d) => d.key === key);
      if (!def) continue;
      const v = fromDisplay(def, raw);
      if (v !== saved[key]) out[key] = v;
    }
    return out;
  }, [draft, defs, saved]);
  const dirty = Object.keys(changes).length;

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setSaved(body.values);
      setDraft({});
      setStatus({ kind: "ok", text: body.changed?.length ? `Saved ${body.changed.length} change(s).` : "Nothing changed." });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function sendDigestPreview() {
    setDigestMsg("Sending…");
    const res = await fetch("/api/admin/digest/preview", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setDigestMsg(res.ok ? `Sent a preview to ${body.sentTo}.` : body.error ?? "Could not send.");
  }

  if (!defs) {
    return (
      <main className="container" style={{ maxWidth: "860px" }}>
        <h1>Settings</h1>
        {status ? (
          <p className="field-error" role="alert">
            {status.text}
          </p>
        ) : (
          <p aria-live="polite">Loading…</p>
        )}
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: "860px" }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Changes apply immediately after saving. No deploy needed.</p>
        </div>
      </div>

      {GROUP_ORDER.map((group) => (
        <section key={group} id={group} className="settings-group" aria-labelledby={`h-${group}`}>
          <h2 id={`h-${group}`}>{group}</h2>
          <p className="setting-help" style={{ marginBottom: "0.5rem" }}>
            {GROUP_INTRO[group]}
          </p>
          {defs
            .filter((d) => d.group === group)
            .map((def) => {
              const current = draft[def.key] ?? toDisplay(def, saved[def.key] ?? def.default);
              const id = `s-${def.key}`;
              const set = (v: string | boolean) => setDraft((d) => ({ ...d, [def.key]: v }));
              return (
                <div className="setting-row" key={def.key}>
                  <div>
                    <label className="setting-label" htmlFor={id}>
                      {def.label}
                    </label>
                    <p className="setting-help" id={`${id}-help`}>
                      {def.help}
                    </p>
                  </div>
                  <div className="setting-control">
                    {def.type === "boolean" && (
                      <label className="switch">
                        <input id={id} type="checkbox" checked={current as boolean} onChange={(e) => set(e.target.checked)} aria-describedby={`${id}-help`} />
                        <span className="switch-track" aria-hidden="true" />
                        <span>{current ? "On" : "Off"}</span>
                      </label>
                    )}
                    {def.type === "money" && (
                      <span className="money-input">
                        $
                        <input id={id} type="number" inputMode="decimal" step="0.01" min={def.min / 100} max={def.max / 100} value={current as string} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-help`} />
                      </span>
                    )}
                    {def.type === "bps" && (
                      <span className="money-input">
                        <input id={id} type="number" inputMode="decimal" step="0.5" min={def.min / 100} max={def.max / 100} value={current as string} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-help`} />
                        %
                      </span>
                    )}
                    {def.type === "integer" && (
                      <span className="money-input">
                        <input id={id} type="number" inputMode="numeric" step="1" min={def.min} max={def.max} value={current as string} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-help`} />
                        {def.unit}
                      </span>
                    )}
                    {def.type === "enum" && (
                      <select id={id} value={current as string} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-help`}>
                        {def.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {def.type === "text" && (
                      <textarea id={id} rows={3} maxLength={def.maxLength} value={current as string} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-help`} />
                    )}
                  </div>
                </div>
              );
            })}
          {group === "Notifications" && (
            <div className="setting-row">
              <div>
                <span className="setting-label">Test the digest</span>
                <p className="setting-help">Email yourself this week&rsquo;s digest now, to check it arrives.</p>
              </div>
              <div className="setting-control">
                <button type="button" className="btn btn-secondary" onClick={() => void sendDigestPreview()}>
                  Send me a preview
                </button>
                {digestMsg && (
                  <p className="setting-help" role="status">
                    {digestMsg}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      ))}

      <div className="save-bar">
        <span role="status" className={status?.kind === "error" ? "field-error" : undefined}>
          {status?.text ?? (dirty ? `${dirty} unsaved change(s)` : "All changes saved.")}
        </span>
        <span style={{ display: "flex", gap: "0.5rem" }}>
          {dirty > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setDraft({})} disabled={saving}>
              Discard
            </button>
          )}
          <button type="button" className="btn" onClick={() => void save()} disabled={saving || dirty === 0}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </span>
      </div>
    </main>
  );
}
