import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { sourceCheck, sourcingRoute } from "@/db/schema";
import { computeValidUntil, type SourceCheckConfidence } from "./staleness";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/rbac";
import { actorUserId } from "@/lib/auth/rbac";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}

/**
 * Recording a fresh check is evidence-gathering, not a price/markup change
 * (build prompt §5) — it never writes `product` or `price_epoch` — so it is
 * not in RESTRICTED_ACTIONS: both owner and ai_operator execute it
 * directly, audited like any other non-restricted admin action. This is
 * the operational "refresh a stale check" action the Action Center points
 * at (build prompt §11: "Source checks expiring").
 */
export async function createSourceCheck(
  input: {
    sourcingRouteId: string;
    stockObserved: number | null;
    priceObservedMinor: number;
    currencyCode: string;
    method: "member_page" | "email_quote" | "phone" | "supplier_confirmation";
    confidence: SourceCheckConfidence;
    evidenceObjectKey?: string | null;
    actor: Actor;
  },
  db: AnyDb = defaultDb,
) {
  const [route] = await db.select().from(sourcingRoute).where(eq(sourcingRoute.id, input.sourcingRouteId)).limit(1);
  if (!route) throw new NotFoundError("Sourcing route not found");

  const checkedAt = new Date();
  const validUntil = await computeValidUntil(input.confidence, checkedAt);

  const [created] = await db
    .insert(sourceCheck)
    .values({
      sourcingRouteId: route.id,
      checkedAt,
      checkedBy: actorUserId(input.actor),
      stockObserved: input.stockObserved,
      priceObservedMinor: input.priceObservedMinor,
      currencyCode: input.currencyCode,
      method: input.method,
      confidence: input.confidence,
      validUntil,
      evidenceObjectKey: input.evidenceObjectKey ?? null,
    })
    .returning();

  // Confidence only ever improves the route's on-file confidence when a
  // fresher, higher-quality check lands; never downgraded automatically by
  // a stale check aging out (that's a display-time staleness concern, see
  // lib/catalog/staleness.ts), so this is a plain forward write.
  await db.update(sourcingRoute).set({ confidence: input.confidence }).where(eq(sourcingRoute.id, route.id));

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "source_check.create",
      entityType: "source_check",
      entityId: created!.id,
      after: { sourcingRouteId: route.id, confidence: input.confidence, validUntil },
    },
    db,
  );

  return created!;
}
