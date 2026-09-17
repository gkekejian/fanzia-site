import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { account } from "./account";

/**
 * "A request is not a sale" (build prompt §1) applies doubly to a draft: it
 * is scratch buyer state with zero side effects — saving one never creates
 * an order, notification, or audit-visible business event. One draft per
 * account, upserted in place. `lines` is a plain jsonb array of
 * `{ productId, qtyRequested }`; normalizing this into durable order-line
 * rows is Phase 3's job once the real order model exists — building that
 * structure now, for state that's explicitly throwaway, would be the kind
 * of premature modeling this project's conventions avoid.
 */
export const draftRequest = pgTable("draft_request", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" })
    .unique(),
  lines: jsonb("lines").notNull().default([]),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
