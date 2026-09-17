import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { user } from "./user";

/**
 * Append-only. No code path in this app updates or deletes a row here —
 * not even for the "owner" role (build prompt §14.1: "Owners still cannot
 * delete or alter the audit log — nobody can"). Enforced with a DB-level
 * trigger in migration 0001 (see db/migrations), not just by omission in
 * application code, so a future bug or a stray manual query can't quietly
 * violate it either.
 */
export const auditLog = pgTable("audit_log", {
  id: idColumn(),
  actorUserId: uuid("actor_user_id").references(() => user.id),
  actorRole: text("actor_role"), // denormalized snapshot at time of action
  actorType: text("actor_type").notNull(), // 'owner' | 'ai_operator' | 'system' | 'applicant'
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
