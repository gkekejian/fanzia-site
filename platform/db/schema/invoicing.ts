import { integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { account, accountContact } from "./account";
import { user } from "./user";

/**
 * A buyer's submitted order request. Created from a draft_request at submit
 * time with prices snapshotted (lines carry unit prices, so later catalog
 * changes can't rewrite history). An offer, not a sale: it expires 48 hours
 * after submission and only becomes an invoice when an owner approves it.
 *
 * Rollover policy (platform rule): the FIRST expiry triggers one automatic
 * silent-free rollover (expires_at extended 48h, rollover_count 1,
 * actor=system in the audit log). Any later expiry marks the offer expired
 * with NO silent rollover — the buyer must explicitly reaccept, which
 * creates a fresh order_request row (supersedes_id) and marks the old one
 * superseded. Cancel is always available from submitted/expired.
 *
 * Status lifecycle: submitted → approved/declined/expired/invoiced;
 * expired → (buyer reaccepts) superseded + new submitted row;
 * submitted|expired → cancelled (terminal, buyer- or owner-initiated).
 */
export const orderRequest = pgTable("order_request", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => accountContact.id),
  lines: jsonb("lines").notNull(),
  notes: text("notes"),
  subtotalMinor: integer("subtotal_minor").notNull(),
  smallOrderFeeMinor: integer("small_order_fee_minor").notNull().default(0),
  status: text("status").notNull().default("submitted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /**
   * Silent auto-rollovers consumed by this offer. Hard cap of 1 (see
   * MAX_SILENT_ROLLOVERS in lib/invoicing/rules.ts): the state machine
   * never rolls over an offer with rollover_count >= 1 — that expiry
   * requires explicit buyer reacceptance instead.
   */
  rolloverCount: integer("rollover_count").notNull().default(0),
  /** When the (single) automatic rollover happened; NULL when never rolled over. */
  lastRolledOverAt: timestamp("last_rolled_over_at", { withTimezone: true }),
  /**
   * When the buyer was sent the "offer expires soon" pre-expiry nudge for
   * the current expiry window; NULL when never nudged. The ops sweep sets
   * this only after a successful send, so a failed send leaves it NULL and
   * the next sweep retries the offer instead of skipping it forever.
   * A reaccepted offer is a fresh row (new expiry window), so it may be
   * nudged again — which is the correct behavior.
   */
  expiryNudgeSentAt: timestamp("expiry_nudge_sent_at", { withTimezone: true }),
  /**
   * Set on a fresh offer created by buyer reacceptance: points at the
   * expired offer it replaces (which is marked superseded). The explicit
   * AnyPgColumn return type breaks the self-reference cycle for tsc.
   */
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => orderRequest.id),
  decidedBy: uuid("decided_by").references(() => user.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrderRequestLine = {
  productId: string;
  sku: string;
  name: string;
  qtyRequested: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currencyCode: string;
};

/**
 * An invoice issued against an approved order request. Tax starts at 0 and
 * is owner-adjustable while the invoice is a draft (tax-exempt review is a
 * separate determination; pending counts as taxable but the amount is set
 * by the owner, not computed here).
 *
 * paid_at and funds_cleared_at live on payment rows, deliberately separate:
 * an invoice is only "paid" (cleared) when cleared funds cover the total.
 * Status lifecycle: draft → sent → partial/paid; void is terminal and only
 * allowed when no payments exist.
 */
export const invoice = pgTable("invoice", {
  id: idColumn(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  orderRequestId: uuid("order_request_id").references(() => orderRequest.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  lines: jsonb("lines").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  smallOrderFeeMinor: integer("small_order_fee_minor").notNull().default(0),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  currencyCode: text("currency_code").notNull().default("USD"),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A shipment against a paid invoice. Created only after cleared funds
 * cover the invoice total — nothing ships before cleared funds.
 * Status lifecycle: preparing → shipped → delivered; canceled is terminal
 * and only allowed from preparing. One active shipment per invoice.
 */
export const shipment = pgTable("shipment", {
  id: idColumn(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoice.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id),
  carrier: text("carrier").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  status: text("status").notNull().default("preparing"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  notes: text("notes"),
  cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A payment against an invoice — recorded manually by an owner (card/ACH/wire)
 * or automatically by the Stripe webhook (card). funds_cleared_at is
 * computed at record time (card: immediately; ACH: +5 business days for the
 * account's first three payments, +2 after; wire: NULL until an owner
 * confirms receipt via the confirm-wire endpoint).
 */
export const payment = pgTable("payment", {
  id: idColumn(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoice.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id),
  amountMinor: integer("amount_minor").notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  fundsClearedAt: timestamp("funds_cleared_at", { withTimezone: true }),
  wireConfirmedAt: timestamp("wire_confirmed_at", { withTimezone: true }),
  /**
   * NULL when the payment was recorded automatically by the Stripe webhook
   * (no human owner pressed a button); set for manual recordings.
   */
  recordedBy: uuid("recorded_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
