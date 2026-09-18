import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { settings as settingsTable } from "@/db/schema";
import { SETTINGS_KEYS } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Next invoice number in FZ-000001 format, from the 'invoice.sequence'
 * counter in the settings table. Runs inside a transaction with a row lock
 * so concurrent approvals can't issue the same number.
 */
export async function nextInvoiceNumber(db: AnyDb = defaultDb): Promise<string> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTINGS_KEYS.invoiceSequence))
      .for("update")
      .limit(1);
    const current = rows[0] ? Number(rows[0].value) : 0;
    if (!Number.isInteger(current) || current < 0) {
      throw new Error("Invoice sequence setting holds an invalid value.");
    }
    const next = current + 1;
    await tx
      .insert(settingsTable)
      .values({
        key: SETTINGS_KEYS.invoiceSequence,
        value: next,
        description: "Last issued invoice sequence number (FZ-000000 format)",
      })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: next, updatedAt: new Date() },
      });
    return `FZ-${String(next).padStart(6, "0")}`;
  });
}
