import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { account, accountContact } from "./account";
import { user } from "./user";

/**
 * A buyer's submitted order request. Created from a draft_request at submit
 * time with prices snapshotted (lines carry unit prices, so later catalog
 * changes can't rewrite history). An offer, not a sale: it expires 48 hours
 * after submission and only becomes an invoice when an owner approves it.
 *
 * Status lifecycle: submitted → approved/declined/expired → invoiced
 * (invoiced is set on the request once approve() creates the invoice).
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
