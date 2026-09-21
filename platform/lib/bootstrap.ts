import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { currency, termsVersion, user as userTable } from "@/db/schema";
import { DRAFT_POLICIES } from "@/lib/policies/content";

/**
 * Parse the BOOTSTRAP_OWNER_EMAILS env var (comma-separated emails) into a
 * clean, deduplicated list. Anything without an "@" is dropped.
 */
export function parseBootstrapOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && e.includes("@")),
    ),
  ];
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const titled = local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return titled || email;
}

/**
 * Publish the draft policy documents as the current terms_version rows.
 * Insert-only: it never touches an existing published row, so a future real
 * (lawyer-reviewed) version published through the admin flow is never
 * overwritten. When the draft's versionLabel in DRAFT_POLICIES is newer than
 * the latest published row for a doc type, a new immutable version is
 * published so buyer-facing text (clickwrap, policy pages) always reflects
 * the current draft without a manual publish step.
 *
 * This is the production-safe counterpart to the same block in db/seed.ts
 * (which refuses to run outside local/dev). Without a published row the
 * application form's clickwrap has nothing to link to and submissions are
 * rejected. The DRAFT_POLICIES body text itself is marked DRAFT — PENDING
 * LEGAL REVIEW; "published" here means "the current version buyers see and
 * accept," not "final legal document."
 */
export async function bootstrapTerms(): Promise<string[]> {
  const published: string[] = [];
  for (const [docType, policy] of Object.entries(DRAFT_POLICIES) as [
    keyof typeof DRAFT_POLICIES,
    (typeof DRAFT_POLICIES)[keyof typeof DRAFT_POLICIES],
  ][]) {
    const latest = await db
      .select({ id: termsVersion.id, versionLabel: termsVersion.versionLabel })
      .from(termsVersion)
      .where(and(eq(termsVersion.docType, docType), isNotNull(termsVersion.publishedAt)))
      .orderBy(desc(termsVersion.publishedAt))
      .limit(1);
    const latestLabel = latest.length > 0 ? latest[0]?.versionLabel : undefined;
    if (latestLabel === policy.versionLabel) continue;
    await db.insert(termsVersion).values({
      docType,
      versionLabel: policy.versionLabel,
      bodyMarkdown: policy.body,
      isDraft: false,
      publishedAt: new Date(),
    });
    published.push(`${docType}@${policy.versionLabel}`);
  }
  return published;
}

/**
 * Seed the ISO 4217 currency reference rows the pricing pipeline depends on.
 * Idempotent (onConflictDoNothing on the primary key): insert-only, never
 * modifies an existing row.
 *
 * This is the production-safe counterpart to the same block in db/seed.ts
 * (which refuses to run outside local/dev). Without a USD row, publishing a
 * catalog import fails on the price_epoch / source_check currency_code
 * foreign key — discovered during the 2026-09-18 staging transaction test,
 * where the import publish POST 500'd with no seeded currencies present.
 */
export async function bootstrapCurrencies(): Promise<string[]> {
  const rows = [
    { code: "USD", exponent: 2, name: "US Dollar" },
    { code: "JPY", exponent: 0, name: "Japanese Yen" },
  ];
  await db.insert(currency).values(rows).onConflictDoNothing();
  return rows.map((r) => r.code);
}

/**
 * Create any missing owner rows for the given emails. Idempotent — running it
 * again (or concurrently, thanks to the email unique constraint) never
 * duplicates or modifies existing users. It only ever INSERTs; it never
 * changes roles, names, or active flags on rows that already exist.
 *
 * This is the production-safe counterpart to db/seed.ts (which refuses to run
 * outside local/dev): it provisions the real, named owners and nothing else.
 * No fixtures, no test data, no ai_operator keys.
 */
export async function bootstrapOwners(emails: string[]): Promise<string[]> {
  const created: string[] = [];
  for (const email of emails) {
    const existing = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);
    if (existing.length > 0) continue;
    try {
      await db.insert(userTable).values({
        email,
        name: displayNameFromEmail(email),
        role: "owner",
        active: true,
      });
      created.push(email);
    } catch (err) {
      // Lost a concurrent-insert race (unique email constraint): the row
      // exists now, which is the outcome we wanted anyway.
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
    }
  }
  return created;
}
