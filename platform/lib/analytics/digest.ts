import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { formatMoney } from "@/lib/format";
import { getSetting, setSetting } from "@/lib/settings";
import { computeKpis, type Kpis } from "./kpis";
import { getActionQueue, type ActionItem } from "@/lib/ops/today";
import { runHealthChecks, type HealthReport } from "@/lib/ops/health";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const DIGEST_LAST_SENT_KEY = "weekly_digest_last_sent_on";

const pct = (b: number | null) => (b === null ? "n/a" : `${(b / 100).toFixed(1)}%`);

function delta(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? "flat" : "new";
  const d = ((now - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}% vs prior week`;
}

/** Pure: build the digest email from already-computed data (unit-tested). */
export function buildDigest(k: Kpis, queue: ActionItem[], health: HealthReport, baseUrl: string): { subject: string; text: string } {
  const lines: string[] = [];
  const auto = k.automation.automationRateBps;
  const subject = `Fanzia weekly: ${formatMoney(k.revenue.invoicedMinor)} invoiced, ${k.orders.invoiced} order(s)${
    queue.length ? `, ${queue.length} thing(s) waiting on you` : ", nothing waiting on you"
  }`;

  lines.push("THE NUMBERS (last 7 days)");
  lines.push(`- Invoiced: ${formatMoney(k.revenue.invoicedMinor)} (${delta(k.revenue.invoicedMinor, k.previous.invoicedMinor)})`);
  lines.push(`- Orders: ${k.orders.invoiced} invoiced, ${k.orders.submitted} submitted, ${k.orders.expired} expired, ${k.orders.declined} declined`);
  lines.push(`- Collected: ${formatMoney(k.revenue.collectedMinor)}`);
  lines.push(
    `- Gross margin: ${pct(k.revenue.grossMarginBps)}${k.revenue.costCoverageBps < 10000 && k.revenue.invoicedMinor > 0 ? ` (cost known for ${pct(k.revenue.costCoverageBps)} of revenue)` : ""}`,
  );
  lines.push(`- Unpaid invoices: ${formatMoney(k.receivables.openMinor)}${k.receivables.buckets[3]!.count ? `, ${k.receivables.buckets[3]!.count} over 30 days` : ""}`);
  if (k.refunds.owedMinor > 0) lines.push(`- Refunds owed to buyers: ${formatMoney(k.refunds.owedMinor)}`);
  lines.push(`- Buyers: ${k.buyers.active} active, ${k.buyers.firstTime} first-time; repeat rate ${pct(k.buyers.repeatRateBps)}`);
  lines.push(`- Funnel: ${k.funnel.waitlist} waitlist, ${k.funnel.applications} applications, ${k.funnel.approved} approved, ${k.funnel.firstOrders} first orders`);
  lines.push("");
  lines.push("IS IT RUNNING ITSELF?");
  lines.push(
    `- Automation: ${pct(auto)} of workflow steps done by the system (${k.automation.systemSteps} system, ${k.automation.ownerSteps} by you)`,
  );
  lines.push(
    `- Your touches: ${k.automation.ownerTouches}${k.automation.ownerTouchesPerOrder !== null ? ` (${k.automation.ownerTouchesPerOrder} per order)` : ""}. Target: 90% automated.`,
  );
  lines.push("");
  lines.push(queue.length ? `WAITING ON YOU (${queue.length})` : "WAITING ON YOU: nothing.");
  for (const item of queue.slice(0, 12)) lines.push(`- ${item.title}. ${item.detail}`);
  if (queue.length > 12) lines.push(`- ...and ${queue.length - 12} more.`);
  lines.push("");
  const problems = health.checks.filter((c) => c.status !== "ok");
  lines.push(problems.length ? "SYSTEM" : "SYSTEM: all checks green.");
  for (const c of problems) lines.push(`- [${c.status.toUpperCase()}] ${c.label}: ${c.detail}${c.fix ? ` Fix: ${c.fix}` : ""}`);
  lines.push("");
  lines.push(`Today: ${baseUrl}/admin`);
  lines.push(`Analytics: ${baseUrl}/admin/analytics`);
  lines.push(`Settings: ${baseUrl}/admin/settings`);

  return { subject, text: lines.join("\n") };
}

function weekdayInLA(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }).toLowerCase();
}

function dateInLA(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * Called by the daily ops sweep. Sends once per digest day (tracked in
 * settings so a retried cron never double-sends).
 */
export async function maybeSendWeeklyDigest(
  db: AnyDb,
  opts: { now: Date; enabled: boolean; day: string; baseUrl: string; send: (p: { to: string; subject: string; text: string }) => Promise<void>; force?: boolean },
): Promise<{ sent: boolean; reason: string; recipients?: number }> {
  if (!opts.enabled && !opts.force) return { sent: false, reason: "disabled" };
  if (!opts.force && weekdayInLA(opts.now) !== opts.day) return { sent: false, reason: "not digest day" };
  const today = dateInLA(opts.now);
  if (!opts.force && (await getSetting<string | null>(DIGEST_LAST_SENT_KEY, null, db)) === today) {
    return { sent: false, reason: "already sent today" };
  }

  const [k, queue, health] = await Promise.all([
    computeKpis(db, { days: 7, now: opts.now }),
    getActionQueue(db, opts.now),
    runHealthChecks(db, opts.now),
  ]);
  const { subject, text } = buildDigest(k, queue, health, opts.baseUrl);
  const owners = await db.select().from(user).where(and(eq(user.role, "owner"), eq(user.active, true)));
  for (const o of owners) await opts.send({ to: o.email, subject, text });
  await setSetting(DIGEST_LAST_SENT_KEY, today, "Date (America/Los_Angeles) the weekly digest last went out", db);
  return { sent: true, reason: "sent", recipients: owners.length };
}
