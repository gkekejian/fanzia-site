import "dotenv/config";
import { db } from "./client";
import {
  currency,
  settings,
  user,
  apiKey,
  termsVersion,
  account,
  accountContact,
  supplier,
  product,
  sourcingRoute,
  priceEpoch,
  sourceCheck,
} from "./schema";
import { generateApiKey } from "@/lib/crypto";
import { DRAFT_POLICIES } from "@/lib/policies/content";
import { priceFromCostAndMarkup, realizedGrossMarginBps } from "@/lib/catalog/pricingMath";
import { eq, and, desc, isNotNull } from "drizzle-orm";

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

/**
 * Clearly-labeled, obviously-fictitious catalog data so the Phase 2
 * public/member catalog split, draft-request flow, and admin import/review
 * screens have something to show in local dev — never real Fanzia supplier
 * names, costs, or availability (PROJECT_SCOPE_FINAL.md §2/§8: "Never
 * invent supplier data, prices, or availability"). Every name below is
 * prefixed FIXTURE so it can never be mistaken for a live record.
 */
async function seedCatalogFixtures(createdBy: string) {
  const [existingSupplier] = await db
    .select()
    .from(supplier)
    .where(eq(supplier.name, "FIXTURE — Sample Supplier (not a real Fanzia source)"))
    .limit(1);
  if (existingSupplier) return; // already seeded

  const [fixtureSupplier] = await db
    .insert(supplier)
    .values({ name: "FIXTURE — Sample Supplier (not a real Fanzia source)", notes: "Local/dev fixture only. Never a real supplier." })
    .returning();

  const fixtureProducts = [
    {
      sku: "FIXTURE-SKU-001",
      name: "FIXTURE — Sample Booster Box (test data)",
      editionLanguage: "Japanese",
      origin: "Japan",
      condition: "sealed" as const,
      packsPerUnit: 30,
      cardsPerPack: 5,
      releaseStatus: "in_stock",
      descriptionOriginal: "Fixture product for local development and demos. Not a real product, price, or supply claim.",
      costMinor: 8000, // $80.00
      markupBps: 3500,
      routeType: "import" as const,
      stockObserved: 40,
    },
    {
      sku: "FIXTURE-SKU-002",
      name: "FIXTURE — Sample Elite Trainer Box (test data)",
      editionLanguage: "English",
      origin: "United States",
      condition: "sealed" as const,
      packsPerUnit: 9,
      cardsPerPack: 10,
      releaseStatus: "in_stock",
      descriptionOriginal: "Fixture product for local development and demos. Not a real product, price, or supply claim.",
      costMinor: 3200, // $32.00
      markupBps: 1750,
      routeType: "domestic" as const,
      stockObserved: 120,
    },
  ];

  for (const fp of fixtureProducts) {
    const [createdProduct] = await db
      .insert(product)
      .values({
        sku: fp.sku,
        name: fp.name,
        editionLanguage: fp.editionLanguage,
        origin: fp.origin,
        condition: fp.condition,
        packsPerUnit: fp.packsPerUnit,
        cardsPerPack: fp.cardsPerPack,
        releaseStatus: fp.releaseStatus,
        descriptionOriginal: fp.descriptionOriginal,
        status: "active",
        publiclyVisible: true,
        imageStatus: "none",
      })
      .returning();

    const [route] = await db
      .insert(sourcingRoute)
      .values({
        productId: createdProduct!.id,
        supplierId: fixtureSupplier!.id,
        routeType: fp.routeType,
        confidence: "observed",
        sourceType: "member_page",
        sourceReference: "fixture://local-dev",
        verifiedBy: createdBy,
        verifiedAt: new Date(),
      })
      .returning();

    const priceMinor = priceFromCostAndMarkup(fp.costMinor, fp.markupBps);
    await db.insert(priceEpoch).values({
      productId: createdProduct!.id,
      sourcingRouteId: route!.id,
      costMinor: fp.costMinor,
      currencyCode: "USD",
      markupBps: fp.markupBps,
      priceMinor,
      realizedGrossMarginBps: realizedGrossMarginBps(fp.costMinor, priceMinor),
      createdBy,
    });

    await db.insert(sourceCheck).values({
      sourcingRouteId: route!.id,
      checkedBy: createdBy,
      stockObserved: fp.stockObserved,
      priceObservedMinor: fp.costMinor,
      currencyCode: "USD",
      method: "member_page",
      confidence: "observed",
      validUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
      evidenceObjectKey: null,
    });
  }

  console.log("[seed] Fixture catalog: 1 fixture supplier, 2 fixture products with price + availability.");
}

/**
 * A single obviously-fictitious buyer account so the member catalog/draft
 * request/buyer-login flow can be exercised locally without any real
 * applicant data (build prompt §2/§8). The email domain is deliberately
 * non-routable-looking and prefixed to avoid ever being mistaken for a
 * real customer.
 */
async function seedFixtureBuyerAccount() {
  const email = "buyer@fixture.fanzia.local";
  const [existing] = await db.select().from(account).where(eq(account.primaryContactEmail, email)).limit(1);
  if (existing) return;

  const [fixtureAccount] = await db
    .insert(account)
    .values({
      legalName: "FIXTURE — Sample Buyer LLC (test data)",
      channelType: "vending",
      taxStatus: "pending",
      addressLine1: "1 Fixture Way",
      city: "Glendale",
      state: "CA",
      postalCode: "91201",
      country: "US",
      primaryContactName: "Fixture Buyer",
      primaryContactEmail: email,
    })
    .returning();

  await db.insert(accountContact).values({
    accountId: fixtureAccount!.id,
    name: "Fixture Buyer",
    email,
    roleOnAccount: "primary",
  });

  console.log(`[seed] Fixture buyer account seeded: ${email} — use /member/login locally to sign in.`);
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
      {
        key: "import_markup_bps_default",
        value: 3500,
        description: "Default markup (bps) for import routes absent a per-route override (build prompt §9: 35%).",
      },
      {
        key: "domestic_markup_bps_default",
        value: 1750,
        description: "Default markup (bps) for domestic routes absent a per-route override (build prompt §9: 17.5%).",
      },
      {
        key: "markup_floor_bps",
        value: 2800,
        description: "Global markup floor (bps) flagged during catalog import review when a route's markup falls below it (build prompt §3: 28%).",
      },
      {
        key: "source_check_staleness_observed_hours",
        value: 72,
        description: "Hours an 'observed' source_check stays valid before it's stale (build prompt §5).",
      },
      {
        key: "source_check_staleness_quoted_days",
        value: 7,
        description: "Days a 'quoted' source_check stays valid before it's stale (build prompt §5).",
      },
      {
        key: "source_check_staleness_confirmed_days",
        value: 30,
        description: "Days a 'confirmed' source_check stays valid absent a supplier-specific term (build prompt §5 default; real supplier terms override per route).",
      },
      {
        key: "buyer_magic_link_ttl_minutes",
        value: 15,
        description: "Minutes a buyer sign-in magic link stays valid.",
      },
      {
        key: "internal_transfer_pricing",
        value: "same_price",
        description:
          "Transfer pricing for Fanzia's own internal vending buyer: 'same_price' invoices internal orders at the published wholesale price book; 'at_cost' is reserved for a future, explicit, audited transfer-pricing policy. Default 'same_price' — George has not decided; nothing in the codebase reads 'at_cost' yet.",
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
    const latest = await db
      .select({ versionLabel: termsVersion.versionLabel })
      .from(termsVersion)
      .where(and(eq(termsVersion.docType, docType), isNotNull(termsVersion.publishedAt)))
      .orderBy(desc(termsVersion.publishedAt))
      .limit(1);
    const latestLabel = latest.length > 0 ? latest[0]?.versionLabel : undefined;
    if (latestLabel !== policy.versionLabel) {
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

  const [anyOwner] = await db.select().from(user).where(eq(user.role, "owner")).limit(1);
  if (anyOwner) {
    await seedCatalogFixtures(anyOwner.id);
    await seedFixtureBuyerAccount();
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
