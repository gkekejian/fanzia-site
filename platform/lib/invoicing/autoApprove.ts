import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, eq, inArray } from "drizzle-orm";
import { account, invoice, orderRequest } from "@/db/schema";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { approveOrderRequest, sendInvoice } from "./service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type AutoApproveResult =
  | { approved: true; invoiceId: string; invoiceNumber: string }
  | { approved: false; reason: string };

/**
 * Removes the owner from the loop for routine repeat orders.
 *
 * Before: every order request sat in /admin/order-requests until an owner
 * approved it, then sat again as a DRAFT invoice until an owner pressed
 * "send". Offers expire after 48 hours, so owner latency directly killed
 * orders. That is a human SLA the business cannot staff.
 *
 * Now a request is approved AND its invoice sent immediately when ALL of:
 *  - auto-approval is enabled (order_auto_approve_max_minor > 0)
 *  - the total is at or under that ceiling
 *  - the account is tax-exempt (resale certificate verified), so no
 *    manual sales-tax line is needed; or it is Fanzia's internal account
 *  - external accounts have at least one PAID invoice (first orders stay
 *    manual: that is the fraud gate)
 *  - the account has no unpaid sent/partial invoices
 *
 * Anything else falls through to the existing manual queue unchanged.
 * Buyers pay by card/ACH before anything is purchased, so an auto-approved
 * request commits no Fanzia capital.
 */
export async function autoApproveIfEligible(db: AnyDb, requestId: string): Promise<AutoApproveResult> {
  const ceiling = Number(await getSetting<number>(SETTINGS_KEYS.orderAutoApproveMaxMinor, 0, db));
  if (!Number.isFinite(ceiling) || ceiling <= 0) return { approved: false, reason: "auto-approval disabled" };

  const [req] = await db.select().from(orderRequest).where(eq(orderRequest.id, requestId)).limit(1);
  if (!req || req.status !== "submitted") return { approved: false, reason: "request not in submitted state" };

  const total = req.subtotalMinor + (req.smallOrderFeeMinor ?? 0);
  if (total > ceiling) return { approved: false, reason: `total above auto-approve ceiling` };

  const [acct] = await db.select().from(account).where(eq(account.id, req.accountId)).limit(1);
  if (!acct) return { approved: false, reason: "account missing" };

  if (acct.kind !== "internal") {
    if (acct.taxStatus !== "exempt") return { approved: false, reason: "tax status not verified exempt" };

    const [paid] = await db
      .select({ n: count() })
      .from(invoice)
      .where(and(eq(invoice.accountId, acct.id), eq(invoice.status, "paid")));
    if ((paid?.n ?? 0) === 0) return { approved: false, reason: "first order (no paid invoice yet)" };

    const [open] = await db
      .select({ n: count() })
      .from(invoice)
      .where(and(eq(invoice.accountId, acct.id), inArray(invoice.status, ["sent", "partial"])));
    if ((open?.n ?? 0) > 0) return { approved: false, reason: "account has an unpaid invoice" };
  }

  const { invoice: created } = await approveOrderRequest(db, requestId, null);
  const sent = await sendInvoice(db, created.id);
  await recordAudit(
    {
      actorType: "system",
      action: "order_request.auto_approved",
      entityType: "order_request",
      entityId: requestId,
      after: { invoiceId: sent.id, invoiceNumber: sent.invoiceNumber, totalMinor: total, ceilingMinor: ceiling },
    },
    db,
  );
  return { approved: true, invoiceId: sent.id, invoiceNumber: sent.invoiceNumber };
}
