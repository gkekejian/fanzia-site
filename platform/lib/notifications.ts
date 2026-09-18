import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { notification as notificationTable, user as userTable } from "@/db/schema";
import { sendNotificationEmail } from "@/lib/email/send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/** Every business event that writes an owner notification row + email. */
export const OWNER_NOTIFICATION_TYPES = [
  "application_submitted",
  "order_placed",
  "allocation_requested",
  "invoice_created",
  "invoice_sent",
  "invoice_paid",
  "payment_failed",
  "shipment_shipped",
  "shipment_delivered",
] as const;
export type OwnerNotificationType = (typeof OWNER_NOTIFICATION_TYPES)[number];

export interface OwnerNotificationEvent {
  type: OwnerNotificationType;
  title: string;
  body: string;
  actorEmail?: string | null;
  entityType?: "application" | "order_request" | "allocation_round" | "invoice" | null;
  entityId?: string | null;
  severity?: "info" | "warning";
}

/**
 * Admin-side half of the transactional notifications required by Phase 1
 * (new application submitted, agent proposal awaiting a decision) — the
 * applicant-side half lives next to each action that causes it
 * (app/api/applications/route.ts, lib/applications/decide.ts). Notifies
 * every active owner rather than a single hard-coded address so it keeps
 * working as owners are added or change (build prompt §15: no marketing
 * stream, transactional only).
 */
export async function notifyOwners(subject: string, text: string, db: AnyDb = defaultDb) {
  const owners = await db
    .select()
    .from(userTable)
    .where(and(eq(userTable.role, "owner"), eq(userTable.active, true)));

  // Best-effort: a failed owner alert must never fail the action that
  // triggered it (would produce duplicate applications / lost proposals).
  await Promise.all(
    owners.map((owner) =>
      sendNotificationEmail({ to: owner.email, subject, text }, "notify-owners"),
    ),
  );
}

/**
 * Where an in-app notification (and its email) links, derived from the
 * entity it describes. Returns null when there is no detail page.
 */
export function notificationLinkPath(
  entityType: OwnerNotificationEvent["entityType"],
  entityId: string | null | undefined,
): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "application":
      return `/admin/applications/${entityId}`;
    case "order_request":
      return `/admin/order-requests/${entityId}`;
    case "allocation_round":
      return `/admin/allocation-rounds/${entityId}`;
    case "invoice":
      return `/admin/invoices/${entityId}`;
  }
}

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}

/**
 * The single helper every business event calls: writes the in-app
 * notification row, then emails both owners (via notifyOwners above).
 * Fully best-effort — a failed notification must never fail the action
 * that triggered it, so a DB write failure is logged loudly as
 * [notifications:write-failed] and swallowed, and email failures are
 * already swallowed inside sendNotificationEmail.
 */
export async function notifyOwnersEvent(
  event: OwnerNotificationEvent,
  db: AnyDb = defaultDb,
): Promise<void> {
  const linkPath = notificationLinkPath(event.entityType ?? null, event.entityId ?? null);
  const emailBody = linkPath ? `${event.body}\n\nView: ${appBaseUrl()}${linkPath}` : event.body;
  try {
    await db.insert(notificationTable).values({
      type: event.type,
      title: event.title,
      body: event.body,
      actorEmail: event.actorEmail ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      severity: event.severity ?? "info",
    });
  } catch (err) {
    console.error(
      "[notifications:write-failed]",
      event.type,
      err instanceof Error ? err.message : String(err),
    );
  }
  await notifyOwners(`[Fanzia] ${event.title}`, emailBody, db);
}

export type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: "info" | "warning";
  readAt: Date | null;
  createdAt: Date;
  linkPath: string | null;
};

function toListItem(row: typeof notificationTable.$inferSelect): NotificationListItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    actorEmail: row.actorEmail,
    entityType: row.entityType,
    entityId: row.entityId,
    severity: row.severity,
    readAt: row.readAt,
    createdAt: row.createdAt,
    linkPath: notificationLinkPath(
      (row.entityType as OwnerNotificationEvent["entityType"]) ?? null,
      row.entityId,
    ),
  };
}

/** Newest first. Owner-only callers (API route + admin page). */
export async function listNotifications(
  db: AnyDb = defaultDb,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationListItem[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const rows = await db
    .select()
    .from(notificationTable)
    .where(opts.unreadOnly ? isNull(notificationTable.readAt) : undefined)
    .orderBy(desc(notificationTable.createdAt))
    .limit(limit);
  return rows.map(toListItem);
}

export async function countUnreadNotifications(db: AnyDb = defaultDb): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationTable)
    .where(isNull(notificationTable.readAt));
  return row?.n ?? 0;
}

/** Idempotent: returns false only when no such notification exists. */
export async function markNotificationRead(db: AnyDb, id: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: notificationTable.id, readAt: notificationTable.readAt })
    .from(notificationTable)
    .where(eq(notificationTable.id, id))
    .limit(1);
  if (!existing) return false;
  if (existing.readAt) return true;
  await db
    .update(notificationTable)
    .set({ readAt: new Date() })
    .where(eq(notificationTable.id, id));
  return true;
}

export async function markAllNotificationsRead(db: AnyDb = defaultDb): Promise<number> {
  const updated = await db
    .update(notificationTable)
    .set({ readAt: new Date() })
    .where(isNull(notificationTable.readAt))
    .returning({ id: notificationTable.id });
  return updated.length;
}

