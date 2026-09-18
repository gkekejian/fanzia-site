import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { auditLog } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type ActorType = "owner" | "ai_operator" | "system" | "applicant" | "buyer";

/**
 * Accepts an injectable db handle (default: the real one) purely so unit
 * tests can point this at an in-process test database — production call
 * sites never pass one and get the real connection.
 */
export async function recordAudit(
  entry: {
    actorUserId?: string | null;
    actorRole?: string | null;
    actorType: ActorType;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  },
  db: AnyDb = defaultDb,
) {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
