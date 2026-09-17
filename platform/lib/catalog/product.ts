import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { product } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { actorUserId, type Actor } from "@/lib/auth/rbac";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}

/**
 * Bulk-edit surface for non-pricing catalog fields (build prompt §11:
 * "status, availability, image status" — availability/pricing themselves
 * only ever change via the import pipeline, see lib/catalog/import). Not
 * restricted: nothing here is a price or markup change.
 */
export async function updateProductFields(
  input: {
    productId: string;
    status?: "draft" | "active" | "inactive";
    publiclyVisible?: boolean;
    imageStatus?: string;
    actor: Actor;
  },
  db: AnyDb = defaultDb,
) {
  const [existing] = await db.select().from(product).where(eq(product.id, input.productId)).limit(1);
  if (!existing) throw new NotFoundError("Product not found");

  const patch: Partial<typeof product.$inferInsert> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.publiclyVisible !== undefined) patch.publiclyVisible = input.publiclyVisible;
  if (input.imageStatus !== undefined) patch.imageStatus = input.imageStatus;

  const [updated] = await db.update(product).set(patch).where(eq(product.id, input.productId)).returning();

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "product.update",
      entityType: "product",
      entityId: input.productId,
      before: { status: existing.status, publiclyVisible: existing.publiclyVisible, imageStatus: existing.imageStatus },
      after: patch,
    },
    db,
  );

  return updated!;
}
