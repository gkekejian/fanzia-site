import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { termsVersion, type termsDocType } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type TermsDocType = (typeof termsDocType.enumValues)[number];

/**
 * The clickwrap checkbox on the application form must link to, and quote,
 * the *published* terms row — never the static DRAFT_POLICIES module
 * directly — so the acceptance snapshot in terms_acceptance stays tied to
 * an immutable, versioned row (db/migrations/0003_immutability_triggers.sql
 * enforces that immutability at the DB layer).
 */
export async function getLatestPublishedTermsVersion(docType: TermsDocType, db: AnyDb = defaultDb) {
  const rows = await db
    .select()
    .from(termsVersion)
    .where(and(eq(termsVersion.docType, docType), isNotNull(termsVersion.publishedAt)))
    .orderBy(desc(termsVersion.publishedAt))
    .limit(1);
  return rows[0] ?? null;
}
