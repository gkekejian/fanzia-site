import "dotenv/config";
import { db } from "./client";
import { currency, settings, user, apiKey, termsVersion } from "./schema";
import { generateApiKey } from "@/lib/crypto";
import { DRAFT_POLICIES } from "@/lib/policies/content";
import { eq, and, isNotNull } from "drizzle-orm";

/**
 * Refuses to run against anything that doesn't look like a local/dev
 * database (migration-plan.md "Review and safety process") — a backstop
 * against ever seeding placeholder owner accounts or test data into a real
 * environment.
 */
function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const looksLocal = /localhost|127\.0\.0\.1|fanzia_platform/.test(url);
  if (process.env.NODE_ENV === "production" || !looksLocal) {
    throw new Error(
      "Refusing to seed: DATABASE_URL does not look like a local/dev database, or NODE_ENV=production.",
    );
  }
}

async function main() {
  assertLocalDatabase();

  await db
    .insert(currency)
    .values([
      { code: "USD", exponent: 2, name: "US Dollar" },
      { code: "JPY", exponent: 0, name: "Japanese Yen" },
    ])
    .onConflictDoNothing();

  await db
    .insert(settings)
    .values([
      {
        key: "application_document_retention_days",
        value: 90,
        description:
          "Days to retain declined/abandoned applicant documents before deletion, absent a legal hold (build prompt §8).",
      },
      {
        key: "resume_token_ttl_hours",
        value: 168,
        description: "Hours a resumable-application email link remains valid (7 days).",
      },
      {
        key: "owner_daily_digest_hour_pst",
        value: 8,
        description: "Hour (America/Los_Angeles) the daily Action Center digest email sends.",
      },
    ])
    .onConflictDoNothing();

  // Publish v1 draft policies as terms_version rows so the clickwrap on the
  // application form (and the standalone policy pages) can link to a real,
  // immutable, versioned row instead of only the static DRAFT_POLICIES
  // module. These are still marked DRAFT — PENDING LEGAL REVIEW in the
  // rendered body text itself; "published" here means "the current version
  // buyers see and accept," not "final legal document" (PROJECT_SCOPE_FINAL.md §8).
  for (const [docType, policy] of Object.entries(DRAFT_POLICIES) as [
    keyof typeof DRAFT_POLICIES,
    (typeof DRAFT_POLICIES)[keyof typeof DRAFT_POLICIES],
  ][]) {
    const existing = await db
      .select()
      .from(termsVersion)
      .where(and(eq(termsVersion.docType, docType), isNotNull(termsVersion.publishedAt)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(termsVersion).values({
        docType,
        versionLabel: policy.versionLabel,
        bodyMarkdown: policy.body,
        isDraft: false,
        publishedAt: new Date(),
      });
    }
  }

  const georgeEmail = process.env.SEED_OWNER_GEORGE_EMAIL ?? "george@fanzia.io";
  const josephEmail = process.env.SEED_OWNER_JOSEPH_EMAIL ?? "CHANGE-BEFORE-USE@fanzia.io";

  const [george] = await db
    .insert(user)
    .values({ email: georgeEmail, name: "George Kekejian", role: "owner" })
    .onConflictDoNothing({ target: user.email })
    .returning();

  const [joseph] = await db
    .insert(user)
    .values({ email: josephEmail, name: "Joseph Moses", role: "owner" })
    .onConflictDoNothing({ target: user.email })
    .returning();

  const [muse] = await db
    .insert(user)
    .values({ email: "muse@fanzia.internal", name: "Muse", role: "ai_operator" })
    .onConflictDoNothing({ target: user.email })
    .returning();

  if (josephEmail.startsWith("CHANGE-BEFORE-USE")) {
    console.warn(
      "\n[seed] WARNING: Joseph Moses seeded with a placeholder email. Set SEED_OWNER_JOSEPH_EMAIL " +
        "before this account can receive magic-link logins. See PROJECT_SCOPE_FINAL.md §7 item 1.\n",
    );
  }

  // Muse's API key: generated once, printed once, stored only as a hash —
  // exactly like the admin UI flow will behave for rotation (build prompt §14.1).
  if (muse) {
    const existingKey = await db.select().from(apiKey).where(eq(apiKey.userId, muse.id)).limit(1);
    if (existingKey.length === 0) {
      const { raw, prefix, hash } = generateApiKey();
      await db.insert(apiKey).values({
        userId: muse.id,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: ["read", "admin:non-restricted"],
        createdBy: muse.id,
      });
      console.log("\n[seed] Muse (ai_operator) API key — shown ONCE, store it now:");
      console.log(`        ${raw}\n`);
    }
  }

  console.log("[seed] Done.", {
    george: george?.email ?? "(already existed)",
    joseph: joseph?.email ?? "(already existed)",
    muse: muse?.email ?? "(already existed)",
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
