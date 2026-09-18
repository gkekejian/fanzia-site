import { and, inArray, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { application } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Duplicate-application guard: only applications that are still alive in
 * the review queue count (submitted / needs_review). Decided applications
 * (approved/declined) and abandoned drafts are out of scope — a declined
 * business is welcome to reapply, and only staff can see drafts.
 *
 * Matching is normalized (trimmed, case-insensitive) on business legal name
 * and on the contact email, because "Acme LLC" vs "acme llc" is the same
 * business typing differently.
 */
const OPEN_STATUSES = ["submitted", "needs_review"] as const;

export type DuplicateApplication = {
  id: string;
  businessLegalName: string;
  contactEmail: string;
  status: string;
};

export function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function findDuplicateApplication(
  businessLegalName: string,
  contactEmail: string,
  db: AnyDb = defaultDb,
): Promise<DuplicateApplication | null> {
  const name = normalizeIdentity(businessLegalName);
  const email = contactEmail.trim().toLowerCase();

  const rows = await db
    .select({
      id: application.id,
      businessLegalName: application.businessLegalName,
      contactEmail: application.contactEmail,
      status: application.status,
    })
    .from(application)
    .where(
      and(
        inArray(application.status, [...OPEN_STATUSES]),
        or(
          sql`lower(regexp_replace(trim(${application.businessLegalName}), '\\s+', ' ', 'g')) = ${name}`,
          sql`lower(trim(${application.contactEmail})) = ${email}`,
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
