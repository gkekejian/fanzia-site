import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import {
  application,
  auditLog,
  contactMessage,
  invoice,
  orderRequest,
  payment,
  priceEpoch,
  refundDue,
  type OrderRequestLine,
} from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Owner KPIs, computed straight from the database (no analytics vendor).
 * Every number here answers one of three questions:
 *   1. Is it making money?          revenue, gross margin, AOV, AR aging
 *   2. Is demand real and repeating? funnel, active/new buyers, repeat rate
 *   3. Is it running itself?         automation rate, owner touches per order
 * The third is the 90/10 test in numbers.
 */
export type Kpis = {
  window: { days: number; start: string; end: string };
  revenue: {
    invoicedMinor: number;
    collectedMinor: number;
    grossProfitMinor: number | null;
    grossMarginBps: number | null;
    /** Share of invoiced revenue whose cost was known (0–10000 bps). Margin is only as good as this. */
    costCoverageBps: number;
  };
  orders: {
    submitted: number;
    invoiced: number;
    autoApproved: number;
    expired: number;
    declined: number;
    cancelled: number;
    avgOrderMinor: number | null;
  };
  buyers: { active: number; firstTime: number; repeatRateBps: number | null };
  funnel: { waitlist: number; applications: number; approved: number; firstOrders: number };
  receivables: { openMinor: number; buckets: { label: string; minor: number; count: number }[] };
  automation: {
    systemSteps: number;
    ownerSteps: number;
    automationRateBps: number | null;
    ownerTouches: number;
    ownerTouchesPerOrder: number | null;
  };
  refunds: { owedMinor: number; refundedMinor: number };
  weekly: { weekStart: string; invoicedMinor: number; orders: number }[];
  previous: { invoicedMinor: number; orders: number; grossMarginBps: number | null };
};

// ── Pure helpers (unit-tested) ─────────────────────────────────────────

export function bps(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 10000);
}

/** Cost per unit for a product at a moment: the latest price epoch effective at or before `at`. */
export function costAt(
  epochs: { productId: string; costMinor: number; effectiveAt: Date }[],
  productId: string,
  at: Date,
): number | null {
  let best: { costMinor: number; effectiveAt: Date } | null = null;
  for (const e of epochs) {
    if (e.productId !== productId || e.effectiveAt > at) continue;
    if (!best || e.effectiveAt > best.effectiveAt) best = e;
  }
  return best ? best.costMinor : null;
}

export function grossProfit(
  invoices: { createdAt: Date; lines: OrderRequestLine[] }[],
  epochs: { productId: string; costMinor: number; effectiveAt: Date }[],
): { revenueMinor: number; costedRevenueMinor: number; profitMinor: number } {
  let revenue = 0;
  let costedRevenue = 0;
  let profit = 0;
  for (const inv of invoices) {
    for (const l of inv.lines ?? []) {
      const lineRevenue = l.unitPriceMinor * l.qtyRequested;
      revenue += lineRevenue;
      const unitCost = costAt(epochs, l.productId, inv.createdAt);
      if (unitCost === null) continue;
      costedRevenue += lineRevenue;
      profit += lineRevenue - unitCost * l.qtyRequested;
    }
  }
  return { revenueMinor: revenue, costedRevenueMinor: costedRevenue, profitMinor: profit };
}

export const AGING_BUCKETS = [
  { label: "0–7 days", max: 7 },
  { label: "8–14 days", max: 14 },
  { label: "15–30 days", max: 30 },
  { label: "30+ days", max: Infinity },
] as const;

export function ageReceivables(
  open: { sentAt: Date | null; createdAt: Date; balanceMinor: number }[],
  now: Date,
): Kpis["receivables"] {
  const buckets = AGING_BUCKETS.map((b) => ({ label: b.label, minor: 0, count: 0 }));
  let total = 0;
  for (const inv of open) {
    if (inv.balanceMinor <= 0) continue;
    const ageDays = (now.getTime() - (inv.sentAt ?? inv.createdAt).getTime()) / DAY;
    const idx = AGING_BUCKETS.findIndex((b) => ageDays <= b.max);
    const bucket = buckets[idx === -1 ? buckets.length - 1 : idx]!;
    bucket.minor += inv.balanceMinor;
    bucket.count += 1;
    total += inv.balanceMinor;
  }
  return { openMinor: total, buckets };
}

/** Workflow steps that count toward "is it running itself". Buyer/applicant actions are excluded. */
const WORKFLOW_PREFIXES = [
  "order_request.",
  "invoice.",
  "refund_due.",
  "allocation_",
  "shipment.",
  "application.",
  "po_pack.",
  "catalog_import.",
];

export function isWorkflowStep(action: string): boolean {
  return WORKFLOW_PREFIXES.some((p) => action.startsWith(p)) && action !== "invoice.stripe_checkout_created";
}

/** Owner attention: everything an owner did except signing in. */
export function isOwnerTouch(action: string): boolean {
  return !action.startsWith("auth.");
}

export function weekStartUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

// ── Loader ─────────────────────────────────────────────────────────────

export async function computeKpis(db: AnyDb, opts: { days?: number; now?: Date } = {}): Promise<Kpis> {
  const days = Math.min(365, Math.max(1, Math.floor(opts.days ?? 30)));
  const now = opts.now ?? new Date();
  const start = new Date(now.getTime() - days * DAY);
  const prevStart = new Date(start.getTime() - days * DAY);
  const weeksStart = weekStartUtc(new Date(now.getTime() - 11 * 7 * DAY));
  const earliest = new Date(Math.min(prevStart.getTime(), weeksStart.getTime()));

  const invoices = await db
    .select()
    .from(invoice)
    // "refunded" = a late allocation-offer payment returned in full: never revenue.
    .where(and(notInArray(invoice.status, ["void", "refunded"]), gte(invoice.createdAt, earliest)));
  const inWindow = invoices.filter((i) => i.createdAt >= start && i.createdAt <= now);
  const inPrev = invoices.filter((i) => i.createdAt >= prevStart && i.createdAt < start);

  const productIds = [
    ...new Set([...inWindow, ...inPrev].flatMap((i) => ((i.lines ?? []) as OrderRequestLine[]).map((l) => l.productId))),
  ].filter(Boolean);
  const epochs =
    productIds.length > 0
      ? await db
          .select({ productId: priceEpoch.productId, costMinor: priceEpoch.costMinor, effectiveAt: priceEpoch.effectiveAt })
          .from(priceEpoch)
          .where(inArray(priceEpoch.productId, productIds))
      : [];

  const asGp = (list: typeof invoices) =>
    grossProfit(
      list.map((i) => ({ createdAt: i.createdAt, lines: (i.lines ?? []) as OrderRequestLine[] })),
      epochs,
    );
  const gp = asGp(inWindow);
  const gpPrev = asGp(inPrev);
  const invoicedMinor = inWindow.reduce((s, i) => s + i.totalMinor, 0);

  const payments = await db.select().from(payment).where(gte(payment.paidAt, start));
  const collectedMinor = payments.filter((p) => p.fundsClearedAt && p.paidAt <= now).reduce((s, p) => s + p.amountMinor, 0);

  // Orders
  const requests = await db
    .select({ status: orderRequest.status, n: count() })
    .from(orderRequest)
    .where(and(gte(orderRequest.createdAt, start), lt(orderRequest.createdAt, now)))
    .groupBy(orderRequest.status);
  const byStatus = new Map(requests.map((r) => [r.status, Number(r.n)]));
  const submittedTotal = [...byStatus.values()].reduce((s, n) => s + n, 0);

  const audits = await db
    .select({ action: auditLog.action, actorType: auditLog.actorType })
    .from(auditLog)
    .where(and(gte(auditLog.createdAt, start), lt(auditLog.createdAt, now)));
  const autoApproved = audits.filter((a) => a.action === "order_request.auto_approved").length;
  let systemSteps = 0;
  let ownerSteps = 0;
  let ownerTouches = 0;
  for (const a of audits) {
    if (a.actorType === "owner" && isOwnerTouch(a.action)) ownerTouches++;
    if (!isWorkflowStep(a.action)) continue;
    if (a.actorType === "system") systemSteps++;
    else if (a.actorType === "owner") ownerSteps++;
  }

  // Buyers
  const activeAccounts = new Set(inWindow.map((i) => i.accountId));
  const paidAll = await db
    .select({ accountId: invoice.accountId, createdAt: invoice.createdAt })
    .from(invoice)
    .where(sql`${invoice.status} = 'paid'`);
  const paidByAccount = new Map<string, Date[]>();
  for (const p of paidAll) paidByAccount.set(p.accountId, [...(paidByAccount.get(p.accountId) ?? []), p.createdAt]);
  let firstTime = 0;
  let repeaters = 0;
  for (const [, dates] of paidByAccount) {
    const first = dates.reduce((a, b) => (a < b ? a : b));
    if (first >= start && first <= now) firstTime++;
    if (dates.length >= 2) repeaters++;
  }

  // Funnel (window-bound)
  const [waitlist] = await db
    .select({ n: count() })
    .from(contactMessage)
    .where(and(sql`${contactMessage.source} = 'waitlist'`, gte(contactMessage.createdAt, start)));
  const apps = await db
    .select({ status: application.status, n: count() })
    .from(application)
    .where(gte(application.createdAt, start))
    .groupBy(application.status);
  const appsSubmitted = apps.filter((a) => a.status !== "draft").reduce((s, a) => s + Number(a.n), 0);
  const appsApproved = apps.filter((a) => a.status === "approved").reduce((s, a) => s + Number(a.n), 0);

  // Receivables (all open, not window-bound)
  const openInv = await db.select().from(invoice).where(inArray(invoice.status, ["sent", "partial"]));
  const openPayments =
    openInv.length > 0
      ? await db.select().from(payment).where(inArray(payment.invoiceId, openInv.map((i) => i.id)))
      : [];
  const receivables = ageReceivables(
    openInv.map((i) => ({
      sentAt: i.sentAt,
      createdAt: i.createdAt,
      balanceMinor: i.totalMinor - openPayments.filter((p) => p.invoiceId === i.id).reduce((s, p) => s + p.amountMinor, 0),
    })),
    now,
  );

  // Refunds
  const refunds = await db.select().from(refundDue);
  const owedMinor = refunds.filter((r) => r.status !== "refunded").reduce((s, r) => s + r.amountMinor, 0);
  const refundedMinor = refunds
    .filter((r) => r.status === "refunded" && r.resolvedAt && r.resolvedAt >= start)
    .reduce((s, r) => s + r.amountMinor, 0);

  // Weekly series (12 weeks, Monday-start, UTC)
  const weekly: Kpis["weekly"] = [];
  for (let w = 0; w < 12; w++) {
    const ws = new Date(weeksStart.getTime() + w * 7 * DAY);
    const we = new Date(ws.getTime() + 7 * DAY);
    const list = invoices.filter((i) => i.createdAt >= ws && i.createdAt < we);
    weekly.push({ weekStart: ws.toISOString().slice(0, 10), invoicedMinor: list.reduce((s, i) => s + i.totalMinor, 0), orders: list.length });
  }

  return {
    window: { days, start: start.toISOString(), end: now.toISOString() },
    revenue: {
      invoicedMinor,
      collectedMinor,
      grossProfitMinor: gp.costedRevenueMinor > 0 ? gp.profitMinor : null,
      grossMarginBps: bps(gp.profitMinor, gp.costedRevenueMinor),
      costCoverageBps: bps(gp.costedRevenueMinor, gp.revenueMinor) ?? 0,
    },
    orders: {
      submitted: submittedTotal,
      invoiced: inWindow.length,
      autoApproved,
      expired: byStatus.get("expired") ?? 0,
      declined: byStatus.get("declined") ?? 0,
      cancelled: byStatus.get("cancelled") ?? 0,
      avgOrderMinor: inWindow.length ? Math.round(invoicedMinor / inWindow.length) : null,
    },
    buyers: { active: activeAccounts.size, firstTime, repeatRateBps: bps(repeaters, paidByAccount.size) },
    funnel: { waitlist: Number(waitlist?.n ?? 0), applications: appsSubmitted, approved: appsApproved, firstOrders: firstTime },
    receivables,
    automation: {
      systemSteps,
      ownerSteps,
      automationRateBps: bps(systemSteps, systemSteps + ownerSteps),
      ownerTouches,
      ownerTouchesPerOrder: inWindow.length ? Math.round((ownerTouches / inWindow.length) * 10) / 10 : null,
    },
    refunds: { owedMinor, refundedMinor },
    weekly,
    previous: {
      invoicedMinor: inPrev.reduce((s, i) => s + i.totalMinor, 0),
      orders: inPrev.length,
      grossMarginBps: bps(gpPrev.profitMinor, gpPrev.costedRevenueMinor),
    },
  };
}
