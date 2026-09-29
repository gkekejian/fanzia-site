import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { buyerInterest, product } from "@/db/schema";
import { getOrderRules } from "@/lib/invoicing/orderRules";
import { isWholeCases } from "@/lib/invoicing/rules";
import { OfferError } from "./context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * A buyer's interest list (docs/allocation-design.md §2): what they'd take
 * from the next drop, in each product's own unit. It is not an order and
 * creates no obligation; it's the demand the suggested split works from.
 */

export const interestInputSchema = z.object({
  lines: z
    .array(z.object({ productId: z.string().uuid(), qtyRequested: z.number().int().positive().max(100000) }))
    .max(300),
});

export type InterestLine = { productId: string; qtyRequested: number };

export async function getInterest(db: AnyDb, accountId: string): Promise<InterestLine[]> {
  const rows = await db.select().from(buyerInterest).where(eq(buyerInterest.accountId, accountId));
  return rows.map((r) => ({ productId: r.productId, qtyRequested: r.desiredQty }));
}

/** Replace the whole list (the catalog stepper saves through on every change). */
export async function saveInterest(db: AnyDb, accountId: string, input: z.infer<typeof interestInputSchema>): Promise<InterestLine[]> {
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.productId, l.qtyRequested);
  const ids = [...merged.keys()];
  const products = ids.length ? await db.select().from(product).where(inArray(product.id, ids)) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const { caseOnly } = await getOrderRules(db);
  for (const [id, qty] of merged) {
    const p = byId.get(id);
    if (!p || p.status !== "active") throw new OfferError("One of these products isn't available any more. Refresh the catalog.", 400);
    if (!isWholeCases(qty, p.unitsPerCase, caseOnly)) {
      throw new OfferError(`${p.name} comes in cases of ${p.unitsPerCase}. Choose a whole number of cases.`, 400);
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(buyerInterest).where(eq(buyerInterest.accountId, accountId));
    if (merged.size) {
      await tx.insert(buyerInterest).values([...merged].map(([productId, desiredQty]) => ({ accountId, productId, desiredQty })));
    }
  });
  return [...merged].map(([productId, qtyRequested]) => ({ productId, qtyRequested }));
}
