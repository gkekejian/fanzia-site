import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, desc, eq, lte, ne } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import {
  account,
  invoice,
  orderRequest,
  payment,
  shipment,
  type OrderRequestLine,
} from "@/db/schema";
import { getDraftRequest, clearDraftRequest } from "@/lib/catalog/draftRequest";
import { getMemberCatalog } from "@/lib/catalog/queries";
import { canOrder, normalizeContactRole } from "@/lib/users/contactRoles";
import { formatMoney } from "@/lib/format";
import {
  OFFER_EXPIRY_HOURS,
  FIRST_ORDER_CAP_MINOR,
  balanceDue,
  canAutoRollover,
  computeFundsClearedAt,
  computeSmallOrderFee,
  invoiceCleared,
  isExpired,
  isValidPaymentMethod,
  meetsMinimum,
  rolloverExpiry,
  type PaymentMethod,
} from "./rules";
import { nextInvoiceNumber } from "./sequences";
import { recordAudit } from "@/lib/audit";
import { notifyOwners, notifyOwnersEvent } from "@/lib/notifications";
import { sendNotificationEmail } from "@/lib/email/send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class InvoicingError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.status = status;
  }
}
export class ViewerForbiddenError extends InvoicingError {
  constructor() {
    super("Your account role is view-only. Ask your account's primary contact for ordering access.", 403);
  }
}
export class EmptyDraftError extends InvoicingError {
  constructor() {
    super("Your draft is empty. Add items from the catalog before submitting.", 400);
  }
}
export class BelowMinimumError extends InvoicingError {
  constructor(subtotalMinor: number) {
    super(
      `This order is ${formatMoney(subtotalMinor)}, below the ${formatMoney(50000)} wholesale minimum. Add more items and try again.`,
      400,
    );
  }
}
export class UnpricedLineError extends InvoicingError {
  constructor() {
    super("Some items in your draft are no longer available at a listed price. Please review your draft and try again.", 400);
  }
}
export class AlreadyDecidedError extends InvoicingError {
  constructor() {
    super("This order request has already been decided.", 409);
  }
}
export class ExpiredError extends InvoicingError {
  constructor() {
    super("This offer expired 48 hours after submission and can no longer be approved.", 400);
  }
}
export class FirstOrderCapError extends InvoicingError {
  constructor(totalMinor: number) {
    super(
      `First orders are capped at ${formatMoney(FIRST_ORDER_CAP_MINOR)}. This invoice would be ${formatMoney(totalMinor)}. Reduce the order or contact the buyer.`,
      400,
    );
  }
}
export class BalanceExceededError extends InvoicingError {
  constructor(balanceMinor: number) {
    super(`Payment exceeds the remaining balance of ${formatMoney(balanceMinor)}.`, 400);
  }
}

export type BuyerIdentity = {
  accountContactId: string;
  accountId: string;
  contactName: string;
  contactEmail: string;
  contactRole: string;
};

type DraftLine = { productId: string; qtyRequested: number };

/**
 * Turn a buyer's draft into an order request: snapshot prices from the
 * member catalog, enforce the $500 minimum, disclose the $25 small-order
 * fee, set the 48-hour expiry, and clear the draft.
 */
export class ImportAcknowledgmentRequiredError extends InvoicingError {
  constructor() {
    super("This order includes imported product. Please acknowledge the import notice before submitting.", 400);
  }
}

export async function submitDraftRequest(db: AnyDb, buyer: BuyerIdentity, opts?: { importAcknowledged?: boolean }) {
  if (!canOrder(normalizeContactRole(buyer.contactRole))) throw new ViewerForbiddenError();

  const draft = await getDraftRequest(buyer.accountId, db);
  const lines = (draft?.lines ?? []) as DraftLine[];
  if (lines.length === 0) throw new EmptyDraftError();

  const catalog = await getMemberCatalog(db);
  const priceById = new Map(catalog.map((p) => [p.id, p]));

  const pricedLines: OrderRequestLine[] = [];
  let hasImportProduct = false;
  for (const line of lines) {
    const item = priceById.get(line.productId);
    if (!item) throw new UnpricedLineError();
    if (item.requiresImportAcknowledgment) hasImportProduct = true;
    const lineTotalMinor = item.priceMinor * line.qtyRequested;
    pricedLines.push({
      productId: item.id,
      sku: item.sku,
      name: item.name,
      qtyRequested: line.qtyRequested,
      unitPriceMinor: item.priceMinor,
      lineTotalMinor,
      currencyCode: item.currencyCode,
    });
  }

  if (hasImportProduct && !opts?.importAcknowledged) {
    throw new ImportAcknowledgmentRequiredError();
  }

  const subtotalMinor = pricedLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  if (!meetsMinimum(subtotalMinor)) throw new BelowMinimumError(subtotalMinor);
  // The $25 small-order fee is external-only: Fanzia's own internal buyer
  // never pays it (Fanzia-as-client design 2026-09-18 §1.1).
  const [acct] = await db
    .select({ kind: account.kind })
    .from(account)
    .where(eq(account.id, buyer.accountId))
    .limit(1);
  const accountKind = acct?.kind === "internal" ? "internal" : "external";
  const smallOrderFeeMinor = computeSmallOrderFee(subtotalMinor, accountKind);

  const [created] = await db
    .insert(orderRequest)
    .values({
      accountId: buyer.accountId,
      contactId: buyer.accountContactId,
      lines: pricedLines,
      notes: draft?.notes ?? null,
      subtotalMinor,
      smallOrderFeeMinor,
      expiresAt: new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000),
    })
    .returning();
  await clearDraftRequest(buyer.accountId, db);
  return created!;
}

type OrderRequestRow = typeof orderRequest.$inferSelect;

/** Fetch a request by id; throws 404 when missing. */
async function getLiveOrderRequest(db: AnyDb, requestId: string): Promise<OrderRequestRow> {
  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, requestId)).limit(1);
  if (!row) throw new InvoicingError("Order request not found.", 404);
  return row;
}

export type ExpiryAction = "none" | "rolled_over" | "expired";

/** The account's primary contact email for buyer-facing offer notifications (null when unknown). */
async function buyerEmailFor(db: AnyDb, accountId: string): Promise<string | null> {
  const [acct] = await db.select().from(account).where(eq(account.id, accountId)).limit(1);
  return acct?.primaryContactEmail ?? null;
}

function offerTotalMinor(req: OrderRequestRow): number {
  return req.subtotalMinor + (req.smallOrderFeeMinor ?? 0);
}

/** Direct buyer-facing URL for an offer (used in notification emails). */
function offerUrl(requestId: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
  return `${base}/member/order-requests/${requestId}`;
}

/**
 * Rollover policy enforcement for a single order request — the heart of
 * the offer state machine.
 *
 * FIRST expiry: one automatic silent-free rollover — expires_at is
 * extended another 48 hours, rollover_count increments, and the transition
 * is audit-logged with actor=system. No buyer action is required or
 * expected. The buyer is notified (nothing for them to do).
 *
 * LATER expiry (rollover budget spent — canAutoRollover is false): the
 * offer is marked expired with NO silent rollover. Revival requires an
 * explicit buyer reacceptance (reacceptExpiredOffer) or the offer stays
 * dead; cancel-and-refund is always offered as the alternative.
 *
 * Returns "none" when the request is not a live submitted offer or has
 * not expired yet. Runs OUTSIDE any decision transaction (same rationale
 * as the old expireStaleRequest): a rejected decision must still leave
 * the request visibly processed rather than rolling the mark back.
 */
export async function processExpiredOffer(
  db: AnyDb,
  requestId: string,
  opts?: { now?: Date },
): Promise<{ action: ExpiryAction; request: OrderRequestRow }> {
  const now = opts?.now ?? new Date();
  const req = await getLiveOrderRequest(db, requestId);
  if (req.status !== "submitted" || !isExpired(req.expiresAt, now)) {
    return { action: "none", request: req };
  }

  const rolloversUsed = req.rolloverCount ?? 0;

  if (canAutoRollover(rolloversUsed)) {
    const newExpiry = rolloverExpiry(now);
    await db
      .update(orderRequest)
      .set({
        expiresAt: newExpiry,
        rolloverCount: rolloversUsed + 1,
        lastRolledOverAt: now,
      })
      .where(and(eq(orderRequest.id, requestId), eq(orderRequest.status, "submitted")));
    const rolled = await getLiveOrderRequest(db, requestId);
    await recordAudit(
      {
        actorType: "system",
        action: "order_request.auto_rolled_over",
        entityType: "order_request",
        entityId: requestId,
        before: { expiresAt: req.expiresAt, rolloverCount: rolloversUsed },
        after: {
          expiresAt: rolled.expiresAt,
          rolloverCount: rolled.rolloverCount,
          lastRolledOverAt: rolled.lastRolledOverAt,
        },
      },
      db,
    );
    const total = formatMoney(offerTotalMinor(rolled));
    await notifyOwners(
      `Offer auto-rolled over (${total})`,
      `Order request ${requestId} expired and was automatically extended 48 hours ` +
        `(rollover 1 of 1 — the next expiry is final and needs buyer reacceptance). ` +
        `New expiry: ${rolled.expiresAt.toISOString()}.`,
      db,
    );
    const to = await buyerEmailFor(db, rolled.accountId);
    if (to) {
      await sendNotificationEmail(
        {
          to,
          subject: "Your Fanzia offer was extended 48 hours",
          text:
            `Good news — your Fanzia wholesale offer of ${total} was automatically extended ` +
            `another 48 hours. It is now valid until ${rolled.expiresAt.toLocaleString()}.\n\n` +
            `This automatic extension happens once per offer; nothing is needed from you right now. ` +
            `If it expires again, you'll be asked to review and reaccept the terms.\n\n` +
            `View your offer: ${offerUrl(rolled.id)}`,
        },
        "offer.auto_rolled_over",
      );
    }
    return { action: "rolled_over", request: rolled };
  }

  // Rollover budget spent: final expiry. Deliberately no silent rollover —
  // the hard cap in canAutoRollover guarantees this path.
  await db
    .update(orderRequest)
    .set({ status: "expired" })
    .where(and(eq(orderRequest.id, requestId), eq(orderRequest.status, "submitted")));
  const expired = await getLiveOrderRequest(db, requestId);
  await recordAudit(
    {
      actorType: "system",
      action: "order_request.expired",
      entityType: "order_request",
      entityId: requestId,
      before: { status: "submitted", rolloverCount: rolloversUsed },
      after: { status: "expired" },
    },
    db,
  );
  const total = formatMoney(offerTotalMinor(expired));
  await notifyOwners(
    `Offer expired with no rollover left (${total})`,
    `Order request ${requestId} expired and its one automatic extension was already used, ` +
      `so it was NOT extended. The buyer must explicitly reaccept the terms or cancel the offer.`,
    db,
  );
  const to = await buyerEmailFor(db, expired.accountId);
  if (to) {
    await sendNotificationEmail(
      {
        to,
        subject: "Your Fanzia offer expired — reaccept or cancel",
        text:
          `Your Fanzia wholesale offer of ${total} has expired. Its one automatic extension ` +
          `was already used, so it can't be extended silently.\n\n` +
          `You have two options:\n` +
          `1. Review and reaccept the same terms to receive a fresh 48-hour offer.\n` +
          `2. Cancel the offer — no payment was taken for it, so there is nothing to refund.\n\n` +
          `Review and choose here: ${offerUrl(expired.id)}`,
      },
      "offer.expired_final",
    );
  }
  return { action: "expired", request: expired };
}

/**
 * Sweep every stale submitted offer through the rollover policy. Intended
 * for the admin-triggered expiry check (and any future scheduler); each
 * offer is processed individually so one bad row can't abort the rest.
 */
export async function processExpiredOffers(
  db: AnyDb,
  opts?: { now?: Date; limit?: number },
): Promise<{ rolledOver: string[]; expired: string[] }> {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 500;
  const stale = await db
    .select({ id: orderRequest.id })
    .from(orderRequest)
    .where(and(eq(orderRequest.status, "submitted"), lte(orderRequest.expiresAt, now)))
    .limit(limit);
  const rolledOver: string[] = [];
  const expired: string[] = [];
  for (const row of stale) {
    const { action } = await processExpiredOffer(db, row.id, { now });
    if (action === "rolled_over") rolledOver.push(row.id);
    else if (action === "expired") expired.push(row.id);
  }
  return { rolledOver, expired };
}

async function priorInvoiceCount(db: AnyDb, accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(invoice)
    .where(and(eq(invoice.accountId, accountId), ne(invoice.status, "void")));
  return row?.n ?? 0;
}

function invoiceStatusFor(totalMinor: number, payments: { amountMinor: number; fundsClearedAt: Date | null }[]): "paid" | "partial" {
  return invoiceCleared(totalMinor, payments) ? "paid" : "partial";
}

/**
 * Approve an order request: creates a draft invoice (fee applied, tax
 * starts at 0 for owner adjustment), assigns the next FZ- number, and
 * marks the request invoiced. Enforces the 48-hour expiry and the $5,000
 * first-order cap.
 *
 * Rollover policy: a stale request first passes through processExpiredOffer,
 * so a first-expiry approval silently consumes the one automatic rollover
 * and proceeds against the renewed offer; a second expiry leaves the
 * offer expired and approval is rejected.
 */
export async function approveOrderRequest(db: AnyDb, requestId: string, ownerId: string | null) {
  const settled = await processExpiredOffer(db, requestId);
  if (settled.request.status === "expired") throw new ExpiredError();
  const result = await db.transaction(async (tx) => {
    const req = await getLiveOrderRequest(tx, requestId);
    if (req.status !== "submitted") throw new AlreadyDecidedError();
    if (isExpired(req.expiresAt)) throw new ExpiredError();

    const prior = await priorInvoiceCount(tx, req.accountId);
    const totalMinor = req.subtotalMinor + (req.smallOrderFeeMinor ?? 0);
    if (prior === 0 && totalMinor > FIRST_ORDER_CAP_MINOR) throw new FirstOrderCapError(totalMinor);

    const invoiceNumber = await nextInvoiceNumber(tx);
    const [created] = await tx
      .insert(invoice)
      .values({
        invoiceNumber,
        orderRequestId: req.id,
        accountId: req.accountId,
        lines: req.lines,
        subtotalMinor: req.subtotalMinor,
        smallOrderFeeMinor: req.smallOrderFeeMinor ?? 0,
        taxMinor: 0,
        totalMinor,
        currencyCode: "USD",
        status: "draft",
        createdBy: ownerId,
      })
      .returning();
    const [updated] = await tx
      .update(orderRequest)
      .set({ status: "invoiced", decidedBy: ownerId, decidedAt: new Date() })
      .where(eq(orderRequest.id, req.id))
      .returning();
    return { request: updated!, invoice: created! };
  });
  await notifyOwnersEvent(
    {
      type: "invoice_created",
      title: `Invoice ${result.invoice.invoiceNumber} created — ${formatMoney(result.invoice.totalMinor)}`,
      body:
        `Invoice ${result.invoice.invoiceNumber} was created from order request ${result.request.id} ` +
        `for ${formatMoney(result.invoice.totalMinor)}. It is a draft until sent.`,
      entityType: "invoice",
      entityId: result.invoice.id,
    },
    db,
  );
  return result;
}

export async function declineOrderRequest(db: AnyDb, requestId: string, ownerId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new InvoicingError("A decline reason is required.", 400);
  if (trimmed.length > 2000) throw new InvoicingError("The decline reason is too long.", 400);

  // A stale request first passes through the rollover policy: on a first
  // expiry the offer is silently renewed and the decline lands on the
  // renewed offer; on a second expiry the offer is dead and declines are
  // rejected (cancel is the terminal path there).
  const settled = await processExpiredOffer(db, requestId);
  if (settled.request.status === "expired") throw new ExpiredError();

  const req = settled.request;
  if (req.status !== "submitted") throw new AlreadyDecidedError();

  const [updated] = await db
    .update(orderRequest)
    .set({ status: "declined", decidedBy: ownerId, decidedAt: new Date(), declineReason: trimmed })
    .where(eq(orderRequest.id, requestId))
    .returning();
  return updated!;
}

/**
 * Explicit buyer reacceptance of an expired offer — the ONLY way to revive
 * an offer whose silent rollover was already consumed. Guardrails:
 * - the caller must be an ordering-capable contact on the offer's account
 *   (reacceptance is an explicit buyer action, never implied);
 * - the offer must be in "expired" status AND have spent its rollover
 *   budget (canAutoRollover false). An offer that still has its automatic
 *   extension available is refused here — the sweep would have rolled it
 *   over instead, so reaching this state means inconsistent data.
 *
 * Creates a FRESH order_request row (same snapshotted terms — lines,
 * prices, fee, notes) with a new 48-hour window and a zeroed rollover
 * budget, linked via supersedes_id; the old offer is marked superseded.
 * Audit-logged with actor=buyer.
 */
export async function reacceptExpiredOffer(
  db: AnyDb,
  requestId: string,
  buyer: BuyerIdentity,
  opts?: { now?: Date; ip?: string | null; userAgent?: string | null },
) {
  if (!canOrder(normalizeContactRole(buyer.contactRole))) throw new ViewerForbiddenError();
  const now = opts?.now ?? new Date();

  const req = await getLiveOrderRequest(db, requestId);
  if (req.accountId !== buyer.accountId) throw new InvoicingError("Order request not found.", 404);
  if (req.status !== "expired") {
    throw new InvoicingError("Only an expired offer can be reaccepted.", 409);
  }
  if (canAutoRollover(req.rolloverCount ?? 0)) {
    throw new InvoicingError(
      "This offer still has its automatic extension available and cannot be reaccepted — it should have been extended automatically.",
      409,
    );
  }

  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(orderRequest)
      .values({
        accountId: req.accountId,
        contactId: req.contactId,
        lines: req.lines,
        notes: req.notes,
        subtotalMinor: req.subtotalMinor,
        smallOrderFeeMinor: req.smallOrderFeeMinor ?? 0,
        status: "submitted",
        expiresAt: rolloverExpiry(now),
        rolloverCount: 0,
        supersedesId: req.id,
      })
      .returning();
    await tx
      .update(orderRequest)
      .set({ status: "superseded", decidedAt: now })
      .where(and(eq(orderRequest.id, req.id), eq(orderRequest.status, "expired")));

    await recordAudit(
      {
        actorType: "buyer",
        actorRole: buyer.contactRole,
        action: "order_request.reaccepted",
        entityType: "order_request",
        entityId: req.id,
        before: { status: "expired", rolloverCount: req.rolloverCount ?? 0 },
        after: {
          status: "superseded",
          newOrderRequestId: fresh!.id,
          newStatus: "submitted",
          newExpiresAt: fresh!.expiresAt,
        },
        ip: opts?.ip ?? null,
        userAgent: opts?.userAgent ?? null,
      },
      tx,
    );

    const total = formatMoney(fresh!.subtotalMinor + (fresh!.smallOrderFeeMinor ?? 0));
    // NB: all DB access inside the transaction goes through tx — the outer
    // db handle would deadlock against the open transaction (single
    // connection in PGlite; same hazard exists for any pooled driver).
    await notifyOwners(
      `Expired offer reaccepted by buyer (${total})`,
      `${buyer.contactName} (${buyer.contactEmail}) explicitly reaccepted expired order request ${req.id}. ` +
        `A fresh offer ${fresh!.id} was created, valid until ${fresh!.expiresAt.toISOString()}.`,
      tx,
    );
    const to = await buyerEmailFor(tx, req.accountId);
    if (to) {
      await sendNotificationEmail(
        {
          to,
          subject: "Your Fanzia offer is renewed",
          text:
            `You reaccepted your Fanzia wholesale offer of ${total}. A fresh offer is now open ` +
            `and valid until ${fresh!.expiresAt.toLocaleString()}.\n\n` +
            `Our team reviews every request before it becomes an invoice.`,
        },
        "offer.reaccepted",
      );
    }
    return fresh!;
  });
}

export type CancelActor =
  | { type: "buyer"; buyer: BuyerIdentity; ip?: string | null; userAgent?: string | null }
  | { type: "owner"; ownerId: string; ip?: string | null; userAgent?: string | null };

/**
 * Cancel-and-refund path, available from "submitted" or "expired" at every
 * expiry. Terminal: a cancelled offer can never be rolled over or
 * reaccepted (the buyer starts over with a new draft request).
 *
 * Refund note: no payment is ever taken at the offer stage — payments exist
 * only against invoices, and invoices are only created by approving a live
 * offer — so refundDueMinor is always 0 here. The audit entry records that
 * explicitly so the "refund" half of cancel-and-refund is auditable.
 */
export async function cancelOrderRequest(
  db: AnyDb,
  requestId: string,
  actor: CancelActor,
  opts?: { reason?: string; now?: Date },
) {
  const now = opts?.now ?? new Date();
  const reason = (opts?.reason ?? "").trim();
  if (reason.length > 2000) throw new InvoicingError("The cancel reason is too long.", 400);

  const req = await getLiveOrderRequest(db, requestId);
  if (actor.type === "buyer") {
    if (!canOrder(normalizeContactRole(actor.buyer.contactRole))) throw new ViewerForbiddenError();
    if (req.accountId !== actor.buyer.accountId) throw new InvoicingError("Order request not found.", 404);
  }
  if (req.status !== "submitted" && req.status !== "expired") {
    throw new AlreadyDecidedError();
  }

  const [updated] = await db
    .update(orderRequest)
    .set({
      status: "cancelled",
      decidedAt: now,
      decidedBy: actor.type === "owner" ? actor.ownerId : null,
    })
    .where(and(eq(orderRequest.id, requestId), eq(orderRequest.status, req.status)))
    .returning();
  const row = updated ?? (await getLiveOrderRequest(db, requestId));

  await recordAudit(
    {
      actorType: actor.type === "buyer" ? "buyer" : "owner",
      actorUserId: actor.type === "owner" ? actor.ownerId : null,
      actorRole: actor.type === "buyer" ? actor.buyer.contactRole : "owner",
      action: "order_request.cancelled",
      entityType: "order_request",
      entityId: requestId,
      before: { status: req.status },
      after: {
        status: "cancelled",
        reason: reason || null,
        // Offers never hold payment: invoices are only created from live
        // offers, so cancelling an offer never owes a refund.
        paymentTaken: false,
        refundDueMinor: 0,
      },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
    db,
  );

  const who = actor.type === "buyer" ? `${actor.buyer.contactName} (${actor.buyer.contactEmail})` : "an owner";
  const total = formatMoney(row.subtotalMinor + (row.smallOrderFeeMinor ?? 0));
  await notifyOwners(
    `Offer cancelled (${total})`,
    `Order request ${requestId} (${req.status}) was cancelled by ${who}` +
      (reason ? ` — reason: ${reason}` : "") +
      `. No payment was taken, so no refund is due.`,
    db,
  );
  const to = await buyerEmailFor(db, row.accountId);
  if (to) {
    await sendNotificationEmail(
      {
        to,
        subject: "Your Fanzia offer was cancelled",
        text:
          `Your Fanzia wholesale offer of ${total} has been cancelled` +
          (reason ? ` — reason: ${reason}` : "") +
          `.\n\nNo payment was taken for this offer, so there is nothing to refund. ` +
          `You can submit a new request from the catalog any time.`,
      },
      "offer.cancelled",
    );
  }
  return row;
}

export async function sendInvoice(db: AnyDb, invoiceId: string) {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv) throw new InvoicingError("Invoice not found.", 404);
  if (inv.status !== "draft") throw new InvoicingError("Only draft invoices can be sent.", 400);
  const [updated] = await db
    .update(invoice)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(invoice.id, invoiceId))
    .returning();
  await notifyOwnersEvent(
    {
      type: "invoice_sent",
      title: `Invoice ${updated!.invoiceNumber} sent — ${formatMoney(updated!.totalMinor)}`,
      body:
        `Invoice ${updated!.invoiceNumber} for ${formatMoney(updated!.totalMinor)} was sent to the buyer. ` +
        `Payment is due per the invoice terms.`,
      entityType: "invoice",
      entityId: updated!.id,
    },
    db,
  );
  // "Sent" previously only flipped a status and notified the OWNERS; the
  // buyer was never told an invoice existed, so unpaid invoices just sat.
  const to = await buyerEmailFor(db, updated!.accountId);
  if (to) {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
    await sendNotificationEmail(
      {
        to,
        subject: `Fanzia invoice ${updated!.invoiceNumber}: ${formatMoney(updated!.totalMinor)} due`,
        text:
          `Your Fanzia wholesale order was approved. Invoice ${updated!.invoiceNumber} ` +
          `for ${formatMoney(updated!.totalMinor)} is ready.\n\n` +
          `Pay by card or see ACH/wire details here: ${base}/member/invoices\n\n` +
          `We place the supplier order once payment clears.`,
      },
      "invoice.sent",
    );
  }
  return updated!;
}

export async function voidInvoice(db: AnyDb, invoiceId: string) {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv) throw new InvoicingError("Invoice not found.", 404);
  if (inv.status !== "draft" && inv.status !== "sent") {
    throw new InvoicingError("Only draft or sent invoices can be voided.", 400);
  }
  const existing = await db.select().from(payment).where(eq(payment.invoiceId, invoiceId)).limit(1);
  if (existing.length > 0) throw new InvoicingError("Invoices with recorded payments cannot be voided.", 400);
  const [updated] = await db
    .update(invoice)
    .set({ status: "void", voidedAt: new Date() })
    .where(eq(invoice.id, invoiceId))
    .returning();
  return updated!;
}

/** Owner-adjustable tax on a draft invoice; the total is recomputed. */
export async function setInvoiceTax(db: AnyDb, invoiceId: string, taxMinor: number) {
  if (!Number.isInteger(taxMinor) || taxMinor < 0) {
    throw new InvoicingError("Tax must be a non-negative whole number of cents.", 400);
  }
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv) throw new InvoicingError("Invoice not found.", 404);
  if (inv.status !== "draft") throw new InvoicingError("Tax can only be adjusted on draft invoices.", 400);
  const totalMinor = inv.subtotalMinor + (inv.smallOrderFeeMinor ?? 0) + taxMinor;
  const [updated] = await db
    .update(invoice)
    .set({ taxMinor, totalMinor })
    .where(eq(invoice.id, invoiceId))
    .returning();
  return updated!;
}

export type RecordPaymentInput = {
  amountMinor: number;
  method: string;
  reference?: string;
  paidAt?: Date;
};

/**
 * Record a manual payment. funds_cleared_at is computed at record time;
 * the invoice becomes "paid" only when cleared funds cover the total —
 * never before.
 */
export async function recordInvoicePayment(db: AnyDb, invoiceId: string, ownerId: string, input: RecordPaymentInput) {
  const { amountMinor, method, reference, paidAt } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new InvoicingError("Payment amount must be a positive whole number of cents.", 400);
  }
  if (!isValidPaymentMethod(method)) throw new InvoicingError("Method must be card, ach, or wire.", 400);
  const paid = paidAt ?? new Date();
  if (paid.getTime() > Date.now() + 60 * 1000) throw new InvoicingError("paid_at cannot be in the future.", 400);

  const result = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
    if (!inv) throw new InvoicingError("Invoice not found.", 404);
    if (inv.status === "void") throw new InvoicingError("Cannot record a payment on a void invoice.", 400);

    const existing = await tx.select().from(payment).where(eq(payment.invoiceId, invoiceId));
    const balance = balanceDue(inv.totalMinor, existing);
    if (amountMinor > balance) throw new BalanceExceededError(balance);

    const [acctCount] = await tx
      .select({ n: count() })
      .from(payment)
      .where(eq(payment.accountId, inv.accountId));
    const fundsClearedAt = computeFundsClearedAt(method as PaymentMethod, paid, acctCount?.n ?? 0);

    const [created] = await tx
      .insert(payment)
      .values({
        invoiceId,
        accountId: inv.accountId,
        amountMinor,
        method,
        reference: reference?.trim() || null,
        paidAt: paid,
        fundsClearedAt,
        recordedBy: ownerId,
      })
      .returning();

    const all = [...existing, created!];
    const [updated] = await tx
      .update(invoice)
      .set({ status: invoiceStatusFor(inv.totalMinor, all) })
      .where(eq(invoice.id, invoiceId))
      .returning();
    return { payment: created!, invoice: updated! };
  });
  await notifyOwnersEvent(
    {
      type: "invoice_paid",
      title: `Payment recorded — ${result.invoice.invoiceNumber} (${formatMoney(result.payment.amountMinor)})`,
      body:
        `A ${result.payment.method} payment of ${formatMoney(result.payment.amountMinor)} was recorded ` +
        `on invoice ${result.invoice.invoiceNumber}. Invoice status is now "${result.invoice.status}".`,
      entityType: "invoice",
      entityId: result.invoice.id,
    },
    db,
  );
  return result;
}

/**
 * Owner confirms a wire arrived: funds clear now. Only for wire payments
 * that haven't cleared yet.
 */
export async function confirmWirePayment(db: AnyDb, paymentId: string) {
  const result = await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
    if (!pay) throw new InvoicingError("Payment not found.", 404);
    if (pay.method !== "wire") throw new InvoicingError("Only wire payments need confirmation.", 400);
    if (pay.fundsClearedAt !== null) throw new InvoicingError("This wire was already confirmed.", 400);

    const now = new Date();
    const [updated] = await tx
      .update(payment)
      .set({ wireConfirmedAt: now, fundsClearedAt: now })
      .where(eq(payment.id, paymentId))
      .returning();

    const [inv] = await tx.select().from(invoice).where(eq(invoice.id, pay.invoiceId)).limit(1);
    const all = await tx.select().from(payment).where(eq(payment.invoiceId, pay.invoiceId));
    const [invUpdated] = await tx
      .update(invoice)
      .set({ status: invoiceStatusFor(inv!.totalMinor, all) })
      .where(eq(invoice.id, pay.invoiceId))
      .returning();
    return { payment: updated!, invoice: invUpdated! };
  });
  await notifyOwnersEvent(
    {
      type: "invoice_paid",
      title: `Wire confirmed — ${result.invoice.invoiceNumber} (${formatMoney(result.payment.amountMinor)})`,
      body:
        `The wire payment of ${formatMoney(result.payment.amountMinor)} on invoice ` +
        `${result.invoice.invoiceNumber} was confirmed received. Invoice status is now ` +
        `"${result.invoice.status}".`,
      entityType: "invoice",
      entityId: result.invoice.id,
    },
    db,
  );
  return result;
}

/** Detail payload for the admin invoice page: payments plus cleared-funds math. */
export async function getInvoiceDetail(db: AnyDb, invoiceId: string) {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv) throw new InvoicingError("Invoice not found.", 404);
  const [acct] = await db.select().from(account).where(eq(account.id, inv.accountId)).limit(1);
  const payments = await db.select().from(payment).where(eq(payment.invoiceId, invoiceId));
  const clearedMinor = payments
    .filter((p) => p.fundsClearedAt !== null && p.fundsClearedAt.getTime() <= Date.now())
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const cleared = invoiceCleared(inv.totalMinor, payments);
  const shipments = await db
    .select()
    .from(shipment)
    .where(eq(shipment.invoiceId, invoiceId))
    .orderBy(desc(shipment.createdAt));
  return {
    invoice: inv,
    account: acct ?? null,
    payments,
    clearedMinor,
    balanceMinor: balanceDue(inv.totalMinor, payments),
    isCleared: cleared,
    readyForFulfillment: cleared && inv.status === "paid",
    shipments,
  };
}
