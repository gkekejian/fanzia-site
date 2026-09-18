import { date, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { idColumn } from "./common";
import { user } from "./user";

/**
 * Lightweight operational cashbook — deliberately NOT double-entry and NOT a
 * replacement for accounting software. One row per money movement:
 *
 * - Auto-posted rows: reference_type/reference_id point back at the source
 *   (e.g. reference_type='payment', reference_id=payment.id) with a unique
 *   partial index so the sync is idempotent — re-running never double-counts.
 * - Manual rows: reference fields stay NULL; owners record refunds, expenses,
 *   owner contributions, and adjustments by hand.
 *
 * Amounts are integer minor units (cents). entry_date is a calendar date so
 * owners can backdate real-world movements (e.g. a check cleared last week).
 */
export const cashbookEntry = pgTable(
  "cashbook_entry",
  {
    id: idColumn(),
    /** Calendar date of the movement. Drizzle maps `date` to a YYYY-MM-DD string. */
    entryDate: date("entry_date").notNull(),
    direction: text("direction").notNull(), // 'in' | 'out'
    amountMinor: integer("amount_minor").notNull(),
    /** 'invoice_payment' | 'refund' | 'expense' | 'adjustment' | 'owner_contribution' */
    category: text("category").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cashbook_entry_reference_unique")
      .on(t.referenceType, t.referenceId)
      .where(sql`"reference_type" IS NOT NULL`),
  ],
);

export const CASHBOOK_CATEGORIES = ["invoice_payment", "refund", "expense", "adjustment", "owner_contribution"] as const;
export type CashbookCategory = (typeof CASHBOOK_CATEGORIES)[number];

export const CASHBOOK_DIRECTIONS = ["in", "out"] as const;
export type CashbookDirection = (typeof CASHBOOK_DIRECTIONS)[number];
