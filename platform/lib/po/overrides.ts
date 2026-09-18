/**
 * Audit-logged supplier override for PO packs.
 *
 * The pack generator may suggest a supplier (suggestSupplierFor in
 * pack.ts); the owner can always override it at pack generation time.
 * Every override is an audit entry — supplier choice on a PO is a
 * consequential procurement decision and must be attributable.
 *
 * Kept separate from lib/po/pack.ts so that module stays pure (no DB).
 */
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { recordAudit, type ActorType } from "@/lib/audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export async function logSupplierOverride(
  args: {
    actorUserId?: string | null;
    actorRole?: string | null;
    actorType: ActorType;
    roundId: string;
    productId: string;
    suggestedSupplierId: string;
    suggestedSource: string;
    overrideSupplierId: string;
    poPackId?: string | null;
  },
  db: AnyDb = defaultDb,
) {
  await recordAudit(
    {
      actorUserId: args.actorUserId ?? null,
      actorRole: args.actorRole ?? null,
      actorType: args.actorType,
      action: "po_pack.supplier_override",
      entityType: "po_pack",
      entityId: args.poPackId ?? null,
      before: {
        roundId: args.roundId,
        productId: args.productId,
        suggestedSupplierId: args.suggestedSupplierId,
        suggestedSource: args.suggestedSource,
      },
      after: {
        roundId: args.roundId,
        productId: args.productId,
        overrideSupplierId: args.overrideSupplierId,
      },
    },
    db,
  );
}
