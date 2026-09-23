import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { getSetting, setSetting, SETTINGS_KEYS } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Application portal kill switch (owner directive 2026-09-23).
 *
 * Closed by default: an unset `applications_open` setting means the portal
 * is shut — the owner explicitly re-opens it from the admin Applications
 * page. This is the fail-safe direction: a missing row can never
 * accidentally re-open intake.
 */
export async function areApplicationsOpen(db: AnyDb = defaultDb): Promise<boolean> {
  return getSetting<boolean>(SETTINGS_KEYS.applicationsOpen, false, db);
}

export async function setApplicationsOpen(open: boolean, db: AnyDb = defaultDb): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.applicationsOpen,
    open,
    "Kill switch for the wholesale application portal: false stops new applications (/apply + POST /api/applications); in-flight applications are unaffected.",
    db,
  );
}
