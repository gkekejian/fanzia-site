import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "./common";

/**
 * Every admin-configurable threshold, cadence, fee, and hold period named
 * in the build prompt lives here as a key/value row, editable without a
 * deploy. Pilot defaults are seeded by db/seed.ts, never hard-coded in
 * application logic.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description").notNull(),
  ...timestamps,
});
