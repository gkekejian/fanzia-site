"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Kpis } from "@/lib/analytics/kpis";

const WINDOWS = [7, 30, 90, 365] as const;
const pct = (b: number | null) => (b === null ? "—" : `${(b / 100).toFixed(1)}%`);
const compactMoney = (minor: number) => {
  const d = minor / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 10_000) return `$${(d / 1000).toFixed(1)}K`;
  return formatMoney(minor);
};

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (prev === 0) return <span className="stat-note">{now === 0 ? `flat vs ${label}` : `new vs ${label}`}</span>;
  const d = ((now - prev) / prev) * 100;
  return (
    <span className={`stat-note ${d >= 0 ? "delta-up" : "delta-down"}`}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}% vs {label}
    </span>
  );
}

/** Single-series weekly column chart: thin columns, 4px rounded caps, hover tooltip, table view. */
function WeeklyChart({ data }: { data: Kpis["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Draw at the container's real pixel width so text stays 11px on phones
  // instead of being scaled down with the viewBox.
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry!.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 200;
  const padL = 48;
  const padB = 22;
  const padT = 16;
  const max = Math.max(1, ...data.map((d) => d.invoicedMinor));
  const niceMax = (() => {
    const dollars = max / 100;
    const mag = Math.pow(10, Math.floor(Math.log10(dollars || 1)));
    return Math.ceil(dollars / mag) * mag * 100;
  })();
  const slot = (W - padL) / data.length;
  const barW = Math.min(24, slot - 6);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);
  const ticks = [0, 0.5, 1].map((f) => Math.round(niceMax * f));
  const lastIdx = data.length - 1;

  return (
    <div className="chart-card" style={{ position: "relative" }}>
      <h2>Invoiced per week</h2>
      <p className="chart-sub">Last 12 weeks, Monday start. Hover or focus a week for the value.</p>
      <div ref={wrap}>
      <svg className="chart-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Invoiced revenue per week for the last 12 weeks">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={padL - 6} y={y(t) + 4} textAnchor="end">
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const top = y(d.invoicedMinor);
          const h = Math.max(0, H - padB - top);
          const r = Math.min(4, h, barW / 2);
          const x0 = cx - barW / 2;
          const path =
            h <= 0
              ? ""
              : `M${x0},${H - padB} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + barW - r},${top} Q${x0 + barW},${top} ${x0 + barW},${top + r} L${x0 + barW},${H - padB} Z`;
          return (
            <g
              key={d.weekStart}
              className="col"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`Week of ${d.weekStart}: ${formatMoney(d.invoicedMinor)}, ${d.orders} orders`}
            >
              <rect className="hit" x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} />
              {path && <path className="bar" d={path} />}
              {(i === lastIdx || i % (W < 420 ? 4 : 3) === 0) && (
                <text className="axis-label" x={cx} y={H - 6} textAnchor="middle">
                  {d.weekStart.slice(5)}
                </text>
              )}
              {i === lastIdx && d.invoicedMinor > 0 && (
                <text className="value-label" x={cx} y={top - 5} textAnchor="middle">
                  {compactMoney(d.invoicedMinor)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>
      {hover !== null && data[hover] && (
        <div className="chart-tooltip" style={{
            left: `calc(1rem + ${padL + slot * hover + slot / 2}px)`,
            top: `calc(4.2rem + ${Math.max(0, y(data[hover]!.invoicedMinor) - 8)}px)`,
            // Keep the tooltip inside the card near either edge.
            transform: hover >= data.length - 3 ? "translate(-100%, -110%)" : hover <= 1 ? "translate(0, -110%)" : undefined,
          }}>
          Week of {data[hover]!.weekStart}: {formatMoney(data[hover]!.invoicedMinor)} · {data[hover]!.orders} order(s)
        </div>
      )}
      <details style={{ marginTop: "0.5rem" }}>
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th style={{ textAlign: "right" }}>Invoiced</th>
              <th style={{ textAlign: "right" }}>Orders</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.weekStart}>
                <td>{d.weekStart}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(d.invoicedMinor)}</td>
                <td style={{ textAlign: "right" }}>{d.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function HBars({ title, sub, rows, format }: { title: string; sub: string; rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="chart-card">
      <h2>{title}</h2>
      <p className="chart-sub">{sub}</p>
      {rows.map((r) => (
        <div className="hbar-row" key={r.label}>
          <span>{r.label}</span>
          <span className="hbar-track" aria-hidden="true">
            <span className="hbar-fill" style={{ display: "block", width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Owner analytics, straight from the database. Three questions: is it
 * making money, is demand real and repeating, is it running itself.
 */
export function AnalyticsConsole() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [k, setK] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setK(null);
    setError(null);
    fetch(`/api/admin/analytics?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load analytics.");
        setK(await res.json());
      })
      .catch((e) => setError(e.message));
  }, [days]);

  const prevLabel = `prior ${days} days`;

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="page-sub">From your own orders, invoices, and audit log. Website traffic lives in Vercel Analytics.</p>
        </div>
        <div className="segmented" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={days === w} onClick={() => setDays(w)}>
              {w === 365 ? "1y" : `${w}d`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!k && !error && <p aria-live="polite">Loading…</p>}

      {k && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "0.5rem 0" }}>Is it making money?</h2>
          <section className="stat-grid">
            <div className="stat stat-hero" style={{ gridColumn: "span 2" }}>
              <div className="stat-label">Invoiced</div>
              <div className="stat-value">{formatMoney(k.revenue.invoicedMinor)}</div>
              <Delta now={k.revenue.invoicedMinor} prev={k.previous.invoicedMinor} label={prevLabel} />
            </div>
            <div className="stat">
              <div className="stat-label">Gross margin</div>
              <div className="stat-value">{pct(k.revenue.grossMarginBps)}</div>
              <div className="stat-note">
                {k.revenue.grossProfitMinor !== null ? `${formatMoney(k.revenue.grossProfitMinor)} profit · ` : ""}cost known on {pct(k.revenue.costCoverageBps)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Collected</div>
              <div className="stat-value">{formatMoney(k.revenue.collectedMinor)}</div>
              <div className="stat-note">cleared funds</div>
            </div>
            <div className="stat">
              <div className="stat-label">Average order</div>
              <div className="stat-value">{k.orders.avgOrderMinor === null ? "—" : formatMoney(k.orders.avgOrderMinor)}</div>
              <div className="stat-note">{k.orders.invoiced} invoiced</div>
            </div>
            <div className="stat">
              <div className="stat-label">Unpaid invoices</div>
              <div className="stat-value">{formatMoney(k.receivables.openMinor)}</div>
              <div className="stat-note">all open, any age</div>
            </div>
            <div className="stat">
              <div className="stat-label">Refunds owed</div>
              <div className="stat-value">{formatMoney(k.refunds.owedMinor)}</div>
              <div className="stat-note">{formatMoney(k.refunds.refundedMinor)} refunded in window</div>
            </div>
            <div className="stat">
              <div className="stat-label">Orders lost</div>
              <div className="stat-value">{k.orders.expired + k.orders.declined + k.orders.cancelled}</div>
              <div className="stat-note">
                {k.orders.expired} expired · {k.orders.declined} declined · {k.orders.cancelled} cancelled
              </div>
            </div>
          </section>

          <div className="two-col" style={{ marginTop: "0.75rem" }}>
            <WeeklyChart data={k.weekly} />
            <HBars
              title="Unpaid invoices by age"
              sub="Days since the invoice was sent."
              rows={k.receivables.buckets.map((b) => ({ label: `${b.label} (${b.count})`, value: b.minor }))}
              format={formatMoney}
            />
          </div>

          <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem" }}>Is demand real and repeating?</h2>
          <div className="two-col">
            <HBars
              title="Funnel"
              sub={`New in the last ${days} days.`}
              rows={[
                { label: "Waitlist", value: k.funnel.waitlist },
                { label: "Applied", value: k.funnel.applications },
                { label: "Approved", value: k.funnel.approved },
                { label: "First order", value: k.funnel.firstOrders },
              ]}
              format={(v) => String(v)}
            />
            <section className="stat-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="stat">
                <div className="stat-label">Active buyers</div>
                <div className="stat-value">{k.buyers.active}</div>
                <div className="stat-note">ordered in window</div>
              </div>
              <div className="stat">
                <div className="stat-label">First-time buyers</div>
                <div className="stat-value">{k.buyers.firstTime}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Repeat rate</div>
                <div className="stat-value">{pct(k.buyers.repeatRateBps)}</div>
                <div className="stat-note">buyers with 2+ paid orders</div>
              </div>
              <div className="stat">
                <div className="stat-label">Orders invoiced</div>
                <div className="stat-value">{k.orders.invoiced}</div>
                <Delta now={k.orders.invoiced} prev={k.previous.orders} label={prevLabel} />
                <div className="stat-note">{k.orders.submitted} request(s) submitted</div>
              </div>
            </section>
          </div>

          <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem" }}>Is it running itself?</h2>
          <section className="stat-grid">
            <div className="stat stat-hero" style={{ gridColumn: "span 2" }}>
              <div className="stat-label">Workflow steps done by the system</div>
              <div className="stat-value">{pct(k.automation.automationRateBps)}</div>
              <div className="stat-note">
                {k.automation.systemSteps} automatic · {k.automation.ownerSteps} by an owner · target 90%
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Owner touches</div>
              <div className="stat-value">{k.automation.ownerTouches}</div>
              <div className="stat-note">every owner action except sign-in</div>
            </div>
            <div className="stat">
              <div className="stat-label">Touches per order</div>
              <div className="stat-value">{k.automation.ownerTouchesPerOrder ?? "—"}</div>
              <div className="stat-note">{k.orders.autoApproved} order(s) auto-approved</div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
