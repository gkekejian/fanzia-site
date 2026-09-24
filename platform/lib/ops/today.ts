import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, asc, count, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import {
  account,
  agentProposal,
  allocationLine,
  allocationRound,
  application,
  contactMessage,
  invoice,
  orderRequest,
  payment,
  refundDue,
  shipment,
} from "@/db/schema";
import { formatMoney } from "@/lib/format";
import { runHealthChecks } from "./health";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type ActionItem = {
  id: string;
  /** Lower = more urgent. */
  priority: number;
  kind:
    | "system"
    | "order_review"
    | "application_review"
    | "invoice_send"
    | "wire_confirm"
    | "refund"
    | "round"
    | "fulfillment"
    | "hold"
    | "proposal"
    | "inbox";
  title: string;
  detail: string;
  href: string;
  severity: "info" | "warn" | "urgent";
  /** Optional one-tap action rendered as a button on the Today page. */
  action?: { label: string; method: "POST"; endpoint: string; body?: Record<string, unknown>; confirm?: string };
  secondaryAction?: { label: string; method: "POST"; endpoint: string; body?: Record<string, unknown>; confirm?: string };
};

const HOUR = 60 * 60 * 1000;

function hoursLeft(until: Date, now: Date): number {
  return Math.max(0, Math.round((until.getTime() - now.getTime()) / HOUR));
}

/**
 * The one list an owner needs to look at: every decision or task the
 * system cannot do on its own, most urgent first. If this list is empty,
 * there is nothing to do today. Each query is isolated so one failure
 * never blanks the page.
 */
export async function getActionQueue(db: AnyDb, now: Date = new Date()): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  const guarded = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error("[today] queue section failed:", (err as Error).message);
    }
  };

  await guarded(async () => {
    const health = await runHealthChecks(db, now);
    for (const c of health.checks.filter((c) => c.status === "fail")) {
      items.push({
        id: `health:${c.key}`,
        priority: 0,
        kind: "system",
        title: `${c.label}: needs attention`,
        detail: c.fix ? `${c.detail} ${c.fix}` : c.detail,
        href: "/admin/system-status",
        severity: "urgent",
      });
    }
  });

  await guarded(async () => {
    const rows = await db
      .select({ r: orderRequest, name: account.legalName })
      .from(orderRequest)
      .innerJoin(account, eq(account.id, orderRequest.accountId))
      .where(eq(orderRequest.status, "submitted"))
      .orderBy(asc(orderRequest.expiresAt));
    for (const { r, name } of rows) {
      const left = hoursLeft(r.expiresAt, now);
      items.push({
        id: `order:${r.id}`,
        priority: left <= 12 ? 1 : 3,
        kind: "order_review",
        title: `Review order: ${name}, ${formatMoney(r.subtotalMinor + (r.smallOrderFeeMinor ?? 0))}`,
        detail: `Expires in ${left}h. Approving creates and emails the invoice.`,
        href: `/admin/order-requests/${r.id}`,
        severity: left <= 12 ? "urgent" : "warn",
      });
    }
  });

  await guarded(async () => {
    const rows = await db
      .select({ id: refundDue.id, amount: refundDue.amountMinor, status: refundDue.status, method: refundDue.method, reason: refundDue.reason, name: account.legalName, createdAt: refundDue.createdAt })
      .from(refundDue)
      .innerJoin(account, eq(account.id, refundDue.accountId))
      .where(inArray(refundDue.status, ["pending", "failed"]));
    for (const r of rows) {
      items.push({
        id: `refund:${r.id}`,
        priority: 2,
        kind: "refund",
        title: `Refund ${formatMoney(r.amount)} to ${r.name}`,
        detail: `${r.status === "failed" ? "Automatic card refund failed. " : ""}${r.reason}`,
        href: "/admin#refunds",
        severity: r.status === "failed" || now.getTime() - r.createdAt.getTime() > 3 * 24 * HOUR ? "urgent" : "warn",
        action:
          r.method === "card"
            ? { label: "Refund to card", method: "POST", endpoint: `/api/admin/refunds/${r.id}/retry`, confirm: `Refund ${formatMoney(r.amount)} to ${r.name}'s card now?` }
            : { label: "Mark paid back (ACH)", method: "POST", endpoint: `/api/admin/refunds/${r.id}/resolve`, body: { method: "ach" }, confirm: `Confirm you sent ${formatMoney(r.amount)} to ${r.name}?` },
        secondaryAction:
          r.method === "card"
            ? { label: "Paid another way", method: "POST", endpoint: `/api/admin/refunds/${r.id}/resolve`, body: { method: "ach" }, confirm: `Confirm you paid ${formatMoney(r.amount)} back outside Stripe?` }
            : undefined,
      });
    }
  });

  await guarded(async () => {
    const rows = await db
      .select({ a: application })
      .from(application)
      .where(inArray(application.status, ["submitted", "needs_review"]))
      .orderBy(asc(application.createdAt));
    for (const { a } of rows) {
      const waitingH = Math.round((now.getTime() - a.createdAt.getTime()) / HOUR);
      items.push({
        id: `application:${a.id}`,
        priority: 4,
        kind: "application_review",
        title: `Review application: ${a.businessLegalName}`,
        detail: `Waiting ${waitingH}h.`,
        href: `/admin/applications/${a.id}`,
        severity: waitingH > 72 ? "warn" : "info",
      });
    }
  });

  await guarded(async () => {
    const drafts = await db
      .select({ i: invoice, name: account.legalName })
      .from(invoice)
      .innerJoin(account, eq(account.id, invoice.accountId))
      .where(eq(invoice.status, "draft"));
    for (const { i, name } of drafts) {
      items.push({
        id: `invoice:${i.id}`,
        priority: 3,
        kind: "invoice_send",
        title: `Send invoice ${i.invoiceNumber} to ${name}`,
        detail: `${formatMoney(i.totalMinor)} is sitting as a draft; the buyer can't pay it yet.`,
        href: `/admin/invoices/${i.id}`,
        severity: "warn",
      });
    }
  });

  await guarded(async () => {
    const wires = await db
      .select({ p: payment, number: invoice.invoiceNumber })
      .from(payment)
      .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
      .where(and(eq(payment.method, "wire"), isNull(payment.wireConfirmedAt)));
    for (const { p, number } of wires) {
      items.push({
        id: `wire:${p.id}`,
        priority: 3,
        kind: "wire_confirm",
        title: `Confirm wire received for ${number}`,
        detail: `${formatMoney(p.amountMinor)} recorded as sent. Check the bank, then confirm so the order can move.`,
        href: `/admin/invoices/${p.invoiceId}`,
        severity: "warn",
      });
    }
  });

  await guarded(async () => {
    const rounds = await db.select().from(allocationRound).where(inArray(allocationRound.status, ["collecting", "allocating", "closed"]));
    for (const r of rounds) {
      if (r.status === "allocating") {
        items.push({ id: `round:${r.id}`, priority: 2, kind: "round", title: `Approve allocation: ${r.name}`, detail: "Split is calculated. Approving closes the round and settles any shortfall refunds.", href: `/admin/allocation-rounds/${r.id}`, severity: "warn" });
      } else if (r.status === "closed") {
        items.push({ id: `round:${r.id}`, priority: 3, kind: "round", title: `Place supplier order: ${r.name}`, detail: "Round is closed. Generate the PO pack, place it with the supplier, then mark it ordered.", href: `/admin/allocation-rounds/${r.id}`, severity: "warn" });
      } else if (r.cutoffAt && r.cutoffAt <= now) {
        items.push({
          id: `round:${r.id}`,
          priority: 2,
          kind: "round",
          title: `Cutoff passed: ${r.name}`,
          detail: "Pull in paid orders, then enter what the supplier can fill and run the allocation.",
          href: `/admin/allocation-rounds/${r.id}`,
          severity: "warn",
          action: { label: "Pull paid orders", method: "POST", endpoint: `/api/admin/allocation-rounds/${r.id}/sync-paid` },
        });
      }
    }
  });

  await guarded(async () => {
    // Paid orders that no supplier round has picked up yet.
    const paid = await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.status, "paid"));
    if (paid.length === 0) return;
    const linked = await db
      .select({ id: allocationLine.sourceInvoiceId })
      .from(allocationLine)
      .where(isNotNull(allocationLine.sourceInvoiceId));
    const shipped = await db.select({ id: shipment.invoiceId }).from(shipment).where(inArray(shipment.status, ["preparing", "shipped", "delivered"]));
    const done = new Set([...linked.map((l) => l.id), ...shipped.map((s) => s.id)]);
    const waiting = paid.filter((p) => !done.has(p.id)).length;
    if (waiting > 0) {
      items.push({
        id: "fulfillment:unrouted",
        priority: 4,
        kind: "fulfillment",
        title: `${waiting} paid order(s) not in a supplier round yet`,
        detail: "Open (or create) the round for the supplier and pull paid orders in.",
        href: "/admin/allocation-rounds",
        severity: "info",
      });
    }
  });

  await guarded(async () => {
    const held = await db.select().from(account).where(isNotNull(account.orderingHoldReason));
    for (const a of held) {
      items.push({
        id: `hold:${a.id}`,
        priority: 5,
        kind: "hold",
        title: `On hold: ${a.legalName}`,
        detail: a.orderingHoldReason ?? "",
        href: `/admin/accounts/${a.id}`,
        severity: "info",
        action: { label: "Lift hold", method: "POST", endpoint: `/api/admin/accounts/${a.id}/hold`, body: { hold: false }, confirm: `Let ${a.legalName} order again?` },
      });
    }
  });

  await guarded(async () => {
    const [p] = await db.select({ n: count() }).from(agentProposal).where(eq(agentProposal.decision, "pending"));
    const n = Number(p?.n ?? 0);
    if (n > 0) items.push({ id: "proposals", priority: 5, kind: "proposal", title: `${n} AI proposal(s) waiting`, detail: "Approve or reject.", href: "/admin/agent-proposals", severity: "info" });
  });

  await guarded(async () => {
    const rows = await db
      .select({ source: contactMessage.source, n: count() })
      .from(contactMessage)
      .where(and(eq(contactMessage.status, "new"), lte(contactMessage.createdAt, now)))
      .groupBy(contactMessage.source);
    const waitlist = rows.filter((r) => r.source === "waitlist").reduce((s, r) => s + Number(r.n), 0);
    const other = rows.filter((r) => r.source !== "waitlist").reduce((s, r) => s + Number(r.n), 0);
    if (other > 0) items.push({ id: "inbox", priority: 6, kind: "inbox", title: `${other} new message(s)`, detail: "From the website contact form.", href: "/admin/inbox", severity: "info" });
    if (waitlist > 0)
      items.push({ id: "waitlist", priority: 7, kind: "inbox", title: `${waitlist} new waitlist signup(s)`, detail: "Invite the best fits when you open the next batch.", href: "/admin/inbox", severity: "info" });
  });

  return items.sort((a, b) => a.priority - b.priority);
}
