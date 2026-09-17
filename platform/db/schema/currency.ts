import { integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Every money column in the platform stores a minor-unit amount plus a
 * currency code, and reads the exponent from here — never assumes 2.
 * JPY (exponent 0) is seeded alongside USD so the convention is exercised
 * from Phase 1 even though JPY-denominated tables (source_check, etc.)
 * don't exist until Phase 2.
 */
export const currency = pgTable("currency", {
  code: text("code").primaryKey(), // ISO 4217, e.g. "USD", "JPY"
  exponent: integer("exponent").notNull(),
  name: text("name").notNull(),
});
