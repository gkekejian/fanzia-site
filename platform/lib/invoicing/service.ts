import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, eq, ne } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import {
  account,
  invoice,
  orderRequest,
  payment,
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
  computeFundsClearedAt,
  computeSmallOrderFee,
  invoiceCleared,
  isExpired,
  isValidPaymentMethod,
  meetsMinimum,
  type PaymentMethod,
} from "./rules";
import { nextInvoiceNumber } from "./sequences";

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
export async function submitDraftRequest(db: AnyDb, buyer: BuyerIdentity) {
  if (!canOrder(normalizeContactRole(buyer.contactRole))) throw new ViewerForbiddenError();

  const draft = await getDraftRequest(buyer.accountId, db);
  const lines = (draft?.lines ?? []) as DraftLine[];
  if (lines.length === 0) throw new EmptyDraftError();

  const catalog = await getMemberCatalog(db);
  const priceById = new Map(catalog.map((p) => [p.id, p]));

  const pricedLines: OrderRequestLine[] = [];
  for (const line of lines) {
    const item = priceById.get(line.productId);
    if (!item) throw new UnpricedLineError();
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

  const subtotalMinor = pricedLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  if (!meetsMinimum(subtotalMinor)) throw new BelowMinimumError(subtotalMinor);
  const smallOrderFeeMinor = computeSmallOrderFee(subtotalMinor);

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

/**
 * Mark a stale submitted request expired OUTSIDE the decision transaction,
 * so a rejected approval/decline still leaves the request visibly expired
 * (throwing inside the transaction would roll the mark back). Returns true
 * when the request was expired by this call.
 */
async function expireStaleRequest(db: AnyDb, requestId: string): Promise<boolean> {
  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, requestId)).limit(1);
  if (!row) throw new InvoicingError("Order request not found.", 404);
  if (row.status === "submitted" && isExpired(row.expiresAt)) {
    await db
      .update(orderRequest)
      .set({ status: "expired" })
      .where(and(eq(orderRequest.id, requestId), eq(orderRequest.status, "submitted")));
    return true;
  }
  return row.status === "expired";
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
 */
export async function approveOrderRequest(db: AnyDb, requestId: string, ownerId: string) {
  if (await expireStaleRequest(db, requestId)) throw new ExpiredError();
  return db.transaction(async (tx) => {
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
}

export async function declineOrderRequest(db: AnyDb, requestId: string, ownerId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new InvoicingError("A decline reason is required.", 400);
  if (trimmed.length > 2000) throw new InvoicingError("The decline reason is too long.", 400);

  if (await expireStaleRequest(db, requestId)) throw new ExpiredError();

  const req = await getLiveOrderRequest(db, requestId);
  if (req.status !== "submitted") throw new AlreadyDecidedError();
  if (isExpired(req.expiresAt)) throw new ExpiredError();

  const [updated] = await db
    .update(orderRequest)
    .set({ status: "declined", decidedBy: ownerId, decidedAt: new Date(), declineReason: trimmed })
    .where(eq(orderRequest.id, requestId))
    .returning();
  return updated!;
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

  return db.transaction(async (tx) => {
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
}

/**
 * Owner confirms a wire arrived: funds clear now. Only for wire payments
 * that haven't cleared yet.
 */
export async function confirmWirePayment(db: AnyDb, paymentId: string) {
  return db.transaction(async (tx) => {
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
  return {
    invoice: inv,
    account: acct ?? null,
    payments,
    clearedMinor,
    balanceMinor: balanceDue(inv.totalMinor, payments),
    isCleared: cleared,
    readyForFulfillment: cleared && inv.status === "paid",
  };
}
