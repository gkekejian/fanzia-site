import { integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { account } from "./account";
import { application } from "./application";
import { contactMessage } from "./contactMessage";
import { product, supplier } from "./catalog";
import { allocationRound } from "./allocation";
import { invoice } from "./invoicing";
import { user } from "./user";

/**
 * Allocation model + invites (migration 0030, docs/allocation-design.md).
 */

/**
 * A personal invite to apply while applications are closed. Only the
 * SHA-256 of the code is stored (codeHash); `codeHint` is the last 4
 * characters so owners can tell invites apart. Single use, tied to
 * `email`, expires at `expiresAt`.
 */
export const applicationInvite = pgTable("application_invite", {
  id: idColumn(),
  codeHash: text("code_hash").notNull().unique(),
  codeHint: text("code_hint").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  note: text("note"),
  sourceMessageId: uuid("source_message_id").references(() => contactMessage.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => user.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedApplicationId: uuid("used_application_id").references((): AnyPgColumn => application.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What a buyer wants, in the product's own selling unit. */
export const buyerInterest = pgTable("buyer_interest", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  desiredQty: integer("desired_qty").notNull(),
  ...timestamps,
});

export const DROP_STATUSES = ["draft", "live", "closed", "cancelled"] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

/** One supplier release/buy offered out to buyers. */
export const allocationDrop = pgTable("allocation_drop", {
  id: idColumn(),
  name: text("name").notNull(),
  supplierId: uuid("supplier_id").references(() => supplier.id),
  /** draft | live | closed | cancelled */
  status: text("status").notNull().default("draft"),
  offerWindowHours: integer("offer_window_hours").notNull().default(48),
  reofferWindowHours: integer("reoffer_window_hours").notNull().default(24),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => user.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  supplierRoundId: uuid("supplier_round_id").references(() => allocationRound.id, { onDelete: "set null" }),
  ...timestamps,
});

export const allocationDropItem = pgTable("allocation_drop_item", {
  id: idColumn(),
  dropId: uuid("drop_id")
    .notNull()
    .references(() => allocationDrop.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  availableQty: integer("available_qty").notNull(),
  /** Quantities must be whole multiples of this (case size when case-only). */
  increment: integer("increment").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const OFFER_STATUSES = [
  "proposed",
  "offered",
  "paying",
  "accepted",
  "reserved",
  "declined",
  "expired",
  "cancelled",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
/** Statuses that hold stock: counted against an item's available quantity. */
export const HOLDING_OFFER_STATUSES: OfferStatus[] = ["proposed", "offered", "paying", "accepted", "reserved"];
/** Statuses where the buyer can still act. */
export const LIVE_OFFER_STATUSES: OfferStatus[] = ["offered", "paying"];

export type ScoreDetail = {
  total: number;
  spend: number;
  paymentSpeed: number;
  acceptance: number;
  tenure: number;
  notes: string[];
};

/** One buyer's all-or-nothing offer for one drop item. */
export const allocationOffer = pgTable("allocation_offer", {
  id: idColumn(),
  dropId: uuid("drop_id")
    .notNull()
    .references(() => allocationDrop.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => allocationDropItem.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  status: text("status").$type<OfferStatus>().notNull().default("proposed"),
  /** 1 = first offers, 2+ = automatic re-offers of released units. */
  wave: integer("wave").notNull().default(1),
  score: integer("score"),
  scoreDetail: jsonb("score_detail").$type<ScoreDetail | null>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  invoiceId: uuid("invoice_id").references((): AnyPgColumn => invoice.id, { onDelete: "set null" }),
  checkoutSessionId: text("checkout_session_id"),
  checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
  /** Short lock so a double tap can't start two card charges at once. */
  chargeStartedAt: timestamp("charge_started_at", { withTimezone: true }),
  lastPaymentError: text("last_payment_error"),
  declineReason: text("decline_reason"),
  createdBy: uuid("created_by").references(() => user.id),
  ...timestamps,
});

export type AllocationOfferRow = typeof allocationOffer.$inferSelect;
export type AllocationDropRow = typeof allocationDrop.$inferSelect;
export type AllocationDropItemRow = typeof allocationDropItem.$inferSelect;
