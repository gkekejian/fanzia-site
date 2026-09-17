import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { user } from "./user";

export const channelType = pgEnum("channel_type", [
  "vending",
  "smoke_shop_convenience",
  "asian_specialty_retail",
  "live_seller",
  "event_seller",
  "other",
]);

/**
 * "pending" is the state right after approval, before any tax review has
 * happened. It must be treated as taxable for invoicing purposes (build
 * prompt §8: "Until reviewed, taxable is the safe default") — "taxable" is
 * a distinct, explicitly-determined state, not the same thing as "pending"
 * even though they behave the same at the register. Phase 3 invoicing
 * logic must check `tax_status !== 'exempt'`, never `tax_status ===
 * 'taxable'`, to avoid missing the "pending" case.
 */
export const taxStatus = pgEnum("tax_status", ["pending", "exempt", "taxable"]);

/**
 * Created only when an application is approved (build prompt §8: "Create
 * the account only upon approval, or explicitly clean up abandoned pending
 * accounts"). No EIN column exists here or anywhere in this schema.
 */
export const account = pgTable("account", {
  id: idColumn(),
  legalName: text("legal_name").notNull(),
  channelType: channelType("channel_type").notNull(),
  taxStatus: taxStatus("tax_status").notNull().default("pending"),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("US"),
  primaryContactName: text("primary_contact_name").notNull(),
  primaryContactEmail: text("primary_contact_email").notNull().unique(),
  primaryContactPhone: text("primary_contact_phone"),
  createdFromApplicationId: uuid("created_from_application_id"),
  ...timestamps,
});

/**
 * Records who reviewed tax-exempt eligibility and on what evidence,
 * separately from the approve/decline decision on the application itself
 * (build prompt §8: "The review screen is one page... the approve button
 * is not blocked by a verification screenshot. Instead, tax-exempt status
 * is blocked until verification evidence exists.").
 */
export const taxDetermination = pgTable("tax_determination", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  status: taxStatus("status").notNull(),
  evidenceObjectKey: text("evidence_object_key"),
  notes: text("notes").notNull(),
  determinedBy: uuid("determined_by")
    .notNull()
    .references(() => user.id),
  determinedAt: timestamp("determined_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Buyer-side contacts on an approved account. Deliberately not linked to
 * the admin `user` table — that table is exclusively the owner/ai_operator
 * identities from build prompt §14.1. Buyer portal login is a later-phase
 * concern; Phase 1 only needs to know who to notify and who accepted terms.
 */
export const accountContact = pgTable("account_contact", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  roleOnAccount: text("role_on_account").notNull().default("primary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
