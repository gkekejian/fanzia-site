import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb } from "@/db/client";
import { draftRequest } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const draftRequestLineSchema = z.object({
  productId: z.string().uuid(),
  qtyRequested: z.number().int().positive().max(100000),
});

export const draftRequestInputSchema = z.object({
  lines: z.array(draftRequestLineSchema).max(200),
  notes: z.string().max(2000).optional().default(""),
});

export type DraftRequestInput = z.infer<typeof draftRequestInputSchema>;

/**
 * "A request is not a sale" (build prompt §1) — this upsert is the entire
 * operation. It never creates an order, allocation, notification, or audit
 * event; a buyer can save and re-save a draft as many times as they like
 * with zero side effects, which is the whole point of a draft (item 6 of
 * Phase 2's scope).
 */
export async function saveDraftRequest(accountId: string, input: DraftRequestInput, db: AnyDb = defaultDb) {
  const [existing] = await db.select().from(draftRequest).where(eq(draftRequest.accountId, accountId)).limit(1);
  if (existing) {
    const [updated] = await db
      .update(draftRequest)
      .set({ lines: input.lines, notes: input.notes || null, updatedAt: new Date() })
      .where(eq(draftRequest.accountId, accountId))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(draftRequest)
    .values({ accountId, lines: input.lines, notes: input.notes || null })
    .returning();
  return created!;
}

export async function getDraftRequest(accountId: string, db: AnyDb = defaultDb) {
  const [row] = await db.select().from(draftRequest).where(eq(draftRequest.accountId, accountId)).limit(1);
  return row ?? null;
}

/** Remove the draft entirely (used after a successful submit). */
export async function clearDraftRequest(accountId: string, db: AnyDb = defaultDb) {
  await db.delete(draftRequest).where(eq(draftRequest.accountId, accountId));
}
