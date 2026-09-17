import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { settings as settingsTable } from "@/db/schema";

/**
 * Every admin-configurable threshold from the build prompt lives here,
 * never as a hard-coded constant in application logic (PROJECT_SCOPE_FINAL.md
 * §2). Phase 1 only reads a handful of these (resume-token TTL, session
 * TTL, retention days); later phases add the commerce-related ones
 * (cutoffs, hold periods, fee amounts) without any schema change.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  const row = rows[0];
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, description: string) {
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
} as const;
