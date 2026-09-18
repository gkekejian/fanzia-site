import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { user as userTable } from "@/db/schema";
import { sendNotificationEmail } from "@/lib/email/send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

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
