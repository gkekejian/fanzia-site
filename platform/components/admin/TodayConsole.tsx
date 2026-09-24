"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { ConfirmAction } from "./ConfirmAction";
import type { ActionItem } from "@/lib/ops/today";
import type { Kpis } from "@/lib/analytics/kpis";

const pct = (b: number | null) => (b === null ? "—" : `${Math.round(b / 100)}%`);

/**
 * The owner's home screen. One question: "what needs me today?" Most
 * urgent first, one-tap actions where the decision is simple, and a short
 * KPI strip so a glance tells you whether the week is healthy. An empty
 * list is the goal state.
 */
export function TodayConsole() {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, k] = await Promise.all([fetch("/api/admin/today"), fetch("/api/admin/analytics?days=7")]);
      if (!t.ok) throw new Error("Could not load today's list.");
      setItems((await t.json()).items);
      if (k.ok) setKpis(await k.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(a: NonNullable<ActionItem["action"]>) {
    setNotice(null);
    const res = await fetch(a.endpoint, {
      method: a.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a.body ?? {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error ?? body.message ?? "That didn't work. Open the item for details.");
      return;
    }
    setNotice(body.added !== undefined ? `Pulled ${body.added} paid order line(s) into the round.` : "Done.");
    await load();
  }

  const urgent = items?.filter((i) => i.severity === "urgent").length ?? 0;

  return (
    <main className="container" style={{ maxWidth: "980px" }}>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="page-sub">
            {items === null
              ? "Loading…"
              : items.length === 0
                ? "Nothing needs you. The system is handling it."
                : `${items.length} thing${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} you${urgent ? `, ${urgent} urgent` : ""}.`}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {kpis && (
        <section aria-label="Last 7 days" className="stat-grid" style={{ marginBottom: "1.25rem" }}>
          <div className="stat">
            <div className="stat-label">Invoiced, 7 days</div>
            <div className="stat-value">{formatMoney(kpis.revenue.invoicedMinor)}</div>
            <div className="stat-note">{kpis.orders.invoiced} order(s)</div>
          </div>
          <div className="stat">
            <div className="stat-label">Gross margin</div>
            <div className="stat-value">{pct(kpis.revenue.grossMarginBps)}</div>
            <div className="stat-note">on orders with known cost</div>
          </div>
          <div className="stat">
            <div className="stat-label">Unpaid invoices</div>
            <div className="stat-value">{formatMoney(kpis.receivables.openMinor)}</div>
            <div className="stat-note">{kpis.receivables.buckets[3]!.count} over 30 days</div>
          </div>
          <div className="stat">
            <div className="stat-label">Automated steps</div>
            <div className="stat-value">{pct(kpis.automation.automationRateBps)}</div>
            <div className="stat-note">target 90%</div>
          </div>
        </section>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="card" style={{ padding: "0.6rem 0.9rem" }}>
          {notice}
        </p>
      )}

      {items && items.length === 0 && (
        <div className="empty-state card">
          <strong>All clear.</strong>
          Orders, payments, reminders and retries are running on their own. The weekly digest will summarize.
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="action-list" id="refunds">
          {items.map((item) => (
            <li key={item.id} className={`action-item action-item-${item.severity}`}>
              <a className="action-title" href={item.href}>
                {item.severity === "urgent" && <span className="visually-hidden">Urgent: </span>}
                {item.title}
              </a>
              <p className="action-detail">{item.detail}</p>
              {(item.action || item.secondaryAction) && (
                <div className="action-buttons">
                  {item.action &&
                    (item.action.confirm ? (
                      <ConfirmAction label={item.action.label} confirmLabel={`Confirm: ${item.action.label}`} detail={item.action.confirm} onConfirm={() => run(item.action!)} />
                    ) : (
                      <button type="button" className="btn" onClick={() => void run(item.action!)}>
                        {item.action.label}
                      </button>
                    ))}
                  {item.secondaryAction && (
                    <ConfirmAction
                      label={item.secondaryAction.label}
                      confirmLabel={`Confirm: ${item.secondaryAction.label}`}
                      detail={item.secondaryAction.confirm}
                      onConfirm={() => run(item.secondaryAction!)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
