import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { invoice } from "@/db/schema";
import { getMemberCatalog } from "./queries";
import { getDraftRequest, saveDraftRequest } from "./draftRequest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class ReorderNotFoundError extends Error {}

export type ReorderAdded = { name: string; qtyRequested: number };
export type ReorderSkipped = { name: string; reason: string };

/**
 * One-click reorder core: copies an invoice's lines into the account's
 * draft, merged with whatever is already there (quantities sum). Only
 * products currently active, visible, and priced can be re-added; anything
 * else lands in `skipped` with an honest reason — never silently dropped.
 * The invoice must belong to `accountId` or ReorderNotFoundError is thrown
 * (the route maps this to 404, so one account's invoices are invisible to
 * another's).
 */
export async function reorderDraftFromInvoice(
  accountId: string,
  invoiceId: string,
  db: AnyDb = defaultDb,
): Promise<{ added: ReorderAdded[]; skipped: ReorderSkipped[] }> {
  const [inv] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.accountId, accountId)))
    .limit(1);
  if (!inv) throw new ReorderNotFoundError("Invoice not found");

  const catalog = await getMemberCatalog(db);
  const byId = new Map(catalog.map((p) => [p.id, p]));

  const added: ReorderAdded[] = [];
  const skipped: ReorderSkipped[] = [];
  const merged = new Map<string, number>();

  const existing = await getDraftRequest(accountId, db);
  for (const line of ((existing?.lines ?? []) as { productId: string; qtyRequested: number }[])) {
    if (line.productId && line.qtyRequested > 0) {
      merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.qtyRequested);
    }
  }

  for (const line of ((inv.lines ?? []) as { productId: string; name: string; qtyRequested: number }[])) {
    const product = line.productId ? byId.get(line.productId) : undefined;
    const name = line.name || "Unknown product";
    if (!line.productId || !(line.qtyRequested > 0)) {
      skipped.push({ name, reason: "This line has no usable quantity." });
      continue;
    }
    if (!product) {
      skipped.push({ name, reason: "No longer in the catalog — it may be discontinued or unpriced." });
      continue;
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.qtyRequested);
    added.push({ name: product.name, qtyRequested: line.qtyRequested });
  }

  await saveDraftRequest(
    accountId,
    {
      lines: [...merged.entries()].map(([productId, qtyRequested]) => ({ productId, qtyRequested })),
      notes: existing?.notes ?? "",
    },
    db,
  );

  return { added, skipped };
}
