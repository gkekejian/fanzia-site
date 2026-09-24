import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { account } from "./account";
import { invoice } from "./invoicing";
import { allocationRound } from "./allocation";
import { user } from "./user";

/**
 * Money owed back to a buyer when a supplier short-ships a paid allocation
 * (migration 0029). Card payments can be refunded automatically through
 * Stripe (setting auto_refund_card_shortfall); anything else stays
 * "pending" on the owner's Today page until marked refunded.
 */
export const refundDue = pgTable("refund_due", {
  id: idColumn(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoice.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => allocationRound.id, { onDelete: "set null" }),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(),
  /** pending | refunded | failed */
  status: text("status").notNull().default("pending"),
  method: text("method"),
  stripeRefundId: text("stripe_refund_id"),
  lastError: text("last_error"),
  resolvedBy: uuid("resolved_by").references(() => user.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Notification emails that failed to send, retried by the daily ops sweep
 * (lib/email/outbox.ts). status: pending | sent | dead.
 */
export const emailOutbox = pgTable("email_outbox", {
  id: idColumn(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  htmlBody: text("html_body"),
  context: text("context").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
