import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  user as userTable,
  currency as currencyTable,
  supplier as supplierTable,
  product as productTable,
  sourcingRoute as routeTable,
  priceEpoch as priceEpochTable,
  sourceCheck as sourceCheckTable,
  account as accountTable,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/rbac";
import type { AuthedUser } from "@/lib/auth/session";
import type { AuthedAgent } from "@/lib/auth/apiKey";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestDb = PgDatabase<any, any, any>;

let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${n++}@test.fanzia.internal`;

export async function seedCurrency(db: TestDb) {
  await db
    .insert(currencyTable)
    .values([
      { code: "USD", exponent: 2, name: "US Dollar" },
      { code: "JPY", exponent: 0, name: "Japanese Yen" },
    ])
    .onConflictDoNothing();
}

export async function makeOwner(db: TestDb, email?: string): Promise<{ actor: Actor; userId: string }> {
  const [row] = await db
    .insert(userTable)
    .values({ email: email ?? unique("owner"), name: "Test Owner", role: "owner" })
    .returning();
  const authed: AuthedUser = { id: row!.id, email: row!.email, name: row!.name, role: "owner" };
  return { actor: { kind: "owner", user: authed }, userId: row!.id };
}

export async function makeAgent(
  db: TestDb,
  scopes: string[] = ["read"],
): Promise<{ actor: Actor; userId: string }> {
  const [row] = await db
    .insert(userTable)
    .values({ email: unique("agent"), name: "Test Agent", role: "ai_operator" })
    .returning();
  const authed: AuthedAgent = {
    id: row!.id,
    email: row!.email,
    name: row!.name,
    role: "ai_operator",
    scopes,
    apiKeyId: "test-api-key-id",
  };
  return { actor: { kind: "ai_operator", agent: authed }, userId: row!.id };
}

export async function makeSupplier(db: TestDb, name = "Test Supplier Co") {
  const [row] = await db.insert(supplierTable).values({ name }).returning();
  return row!;
}

export async function makeProduct(
  db: TestDb,
  overrides: Partial<typeof productTable.$inferInsert> = {},
) {
  const sku = `TEST-SKU-${n++}`;
  const [row] = await db
    .insert(productTable)
    .values({
      sku,
      name: "Test Booster Box",
      editionLanguage: "Japanese",
      origin: "Japan",
      condition: "sealed",
      packsPerUnit: 30,
      cardsPerPack: 5,
      releaseStatus: "released",
      descriptionOriginal: "Clearly-labeled fixture product for automated tests.",
      status: "active",
      publiclyVisible: true,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function makeRoute(
  db: TestDb,
  args: {
    productId: string;
    supplierId: string;
    routeType?: "import" | "domestic";
    markupFloorBpsOverride?: number | null;
    confidence?: "estimated" | "observed" | "quoted" | "confirmed";
  },
) {
  const [row] = await db
    .insert(routeTable)
    .values({
      productId: args.productId,
      supplierId: args.supplierId,
      routeType: args.routeType ?? "import",
      confidence: args.confidence ?? "estimated",
      sourceType: "member_page",
      markupFloorBpsOverride: args.markupFloorBpsOverride ?? null,
    })
    .returning();
  return row!;
}

export async function makePriceEpoch(
  db: TestDb,
  args: {
    productId: string;
    sourcingRouteId?: string | null;
    costMinor?: number;
    currencyCode?: string;
    markupBps?: number;
    priceMinor?: number;
    realizedGrossMarginBps?: number;
  },
) {
  const [row] = await db
    .insert(priceEpochTable)
    .values({
      productId: args.productId,
      sourcingRouteId: args.sourcingRouteId ?? null,
      costMinor: args.costMinor ?? 10000,
      currencyCode: args.currencyCode ?? "USD",
      markupBps: args.markupBps ?? 3500,
      priceMinor: args.priceMinor ?? 13500,
      realizedGrossMarginBps: args.realizedGrossMarginBps ?? 2593,
    })
    .returning();
  return row!;
}

export async function makeSourceCheck(
  db: TestDb,
  args: {
    sourcingRouteId: string;
    stockObserved?: number | null;
    priceObservedMinor?: number;
    currencyCode?: string;
    method?: "member_page" | "email_quote" | "phone" | "supplier_confirmation";
    confidence?: "observed" | "quoted" | "confirmed";
    validUntil?: Date;
    evidenceObjectKey?: string | null;
    checkedBy?: string | null;
  },
) {
  const [row] = await db
    .insert(sourceCheckTable)
    .values({
      sourcingRouteId: args.sourcingRouteId,
      stockObserved: args.stockObserved ?? 42,
      priceObservedMinor: args.priceObservedMinor ?? 10000,
      currencyCode: args.currencyCode ?? "USD",
      method: args.method ?? "member_page",
      confidence: args.confidence ?? "observed",
      validUntil: args.validUntil ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
      evidenceObjectKey: args.evidenceObjectKey ?? null,
      checkedBy: args.checkedBy ?? null,
    })
    .returning();
  return row!;
}

export async function makeAccount(
  db: TestDb,
  overrides: Partial<typeof accountTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(accountTable)
    .values({
      legalName: "Test Buyer LLC",
      channelType: "smoke_shop_convenience",
      addressLine1: "1 Test Way",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Test Buyer",
      primaryContactEmail: unique("buyer"),
      ...overrides,
    })
    .returning();
  return row!;
}

/** Minimal valid import CSV row (headers match lib/catalog/import/rowSchema.ts). */
export const IMPORT_HEADERS =
  "sku,name,edition_language,origin,condition,packs_per_unit,cards_per_pack,release_status,description,supplier_name,route_type,currency_code,cost_minor,markup_bps_override,stock_observed,check_method,check_confidence,evidence_reference";

export function csvRow(cells: (string | number | undefined | null)[]): string {
  return cells
    .map((c) => {
      const s = c === undefined || c === null ? "" : String(c);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}
