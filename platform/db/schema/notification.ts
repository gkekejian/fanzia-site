import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn } from "./common";

export const notificationSeverity = pgEnum("notification_severity", ["info", "warning"]);
export type NotificationSeverity = (typeof notificationSeverity.enumValues)[number];

/**
 * Owner notification center rows. Written by notifyOwnersEvent
 * (lib/notifications.ts) at each business event, alongside the owner
 * emails. Owner-only visibility is enforced by the API routes
 * (app/api/admin/notifications/*) and the admin page guard — nothing
 * here is ever served to buyers.
 *
 * Notifications are never deleted by application code; they are the
 * owners' own activity record. Marking read only sets read_at.
 */
export const notification = pgTable("notification", {
  id: idColumn(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  actorEmail: text("actor_email"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  severity: notificationSeverity("severity").notNull().default("info"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRow = typeof notification.$inferSelect;
