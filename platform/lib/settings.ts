import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { settings as settingsTable } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Every admin-configurable threshold from the build prompt lives here,
 * never as a hard-coded constant in application logic (PROJECT_SCOPE_FINAL.md
 * §2). Phase 1 only reads a handful of these (resume-token TTL, session
 * TTL, retention days); later phases add the commerce-related ones
 * (cutoffs, hold periods, fee amounts) without any schema change.
 *
 * `db` is injectable (default: the real one) purely so unit tests can point
 * this at an in-process test database — production call sites never pass
 * one and get the real connection. Same pattern as lib/audit.ts.
 */
export async function getSetting<T>(key: string, fallback: T, db: AnyDb = defaultDb): Promise<T> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  const row = rows[0];
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, description: string, db: AnyDb = defaultDb) {
  await db
    .insert(settingsTable)
    .values({ key, value, description })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, description, updatedAt: new Date() },
    });
}

export const SETTINGS_KEYS = {
  applicationDocumentRetentionDays: "application_document_retention_days",
  resumeTokenTtlHours: "resume_token_ttl_hours",
  ownerDailyDigestHour: "owner_daily_digest_hour_pst",
  // Phase 2 — catalog and pricing (build prompt §5, §9).
  importMarkupBpsDefault: "import_markup_bps_default",
  domesticMarkupBpsDefault: "domestic_markup_bps_default",
  markupFloorBps: "markup_floor_bps",
  sourceCheckStalenessObservedHours: "source_check_staleness_observed_hours",
  sourceCheckStalenessQuotedDays: "source_check_staleness_quoted_days",
  sourceCheckStalenessConfirmedDays: "source_check_staleness_confirmed_days",
  buyerMagicLinkTtlMinutes: "buyer_magic_link_ttl_minutes",
  // Phase 3 — invoicing (build prompt §1, §9).
  invoiceSequence: "invoice.sequence",
  // Nayax vending connector — weekly restock suggestion cadence (migration 0018).
  suggestionDay: "suggestion_day",
  // Application portal kill switch (owner directive 2026-09-23): when false
  // (or unset — closed by default), /apply and POST /api/applications refuse
  // new submissions while in-flight applications keep working.
  applicationsOpen: "applications_open",
  // Auto-approval ceiling for order requests, in USD minor units. 0 or
  // unset = disabled (every request waits for an owner). See
  // lib/invoicing/autoApprove.ts for the guardrails.
  orderAutoApproveMaxMinor: "order_auto_approve_max_minor",
} as const;
