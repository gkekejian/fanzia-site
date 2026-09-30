import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  account,
  accountContact,
  allocationOffer,
  buyerInterest,
  invoice,
  payment,
  product,
  sourcingRoute,
  type ScoreDetail,
} from "@/db/schema";
import { latestPriceEpochsByProduct } from "@/lib/catalog/queries";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { unitNoun } from "@/lib/member/shopping";
import { canOrder, normalizeContactRole } from "@/lib/users/contactRoles";
import { computeScore, median, wholeMonthsBetween } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Database-backed context for allocation offers: who may receive offers,
 * their scores, what they want, and product units/prices. Pure math lives
 * in ./engine.ts.
 */

export class OfferError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// ── Products ──────────────────────────────────────────────────────────────

/** The unit a quantity counts, e.g. "Booster Box". */
export function sellUnitOf(p: { sellUnit: string | null; name: string }): string {
  return p.sellUnit?.trim() || unitNoun(p.name);
}

/** "1 Booster Box" / "12 Booster Boxs" is wrong; keep plurals simple and safe. */
export function formatUnits(qty: number, unit: string): string {
  if (qty === 1) return `1 ${unit}`;
  const plural = /(x|s|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`;
  return `${qty} ${plural}`;
}

/** Whole-case rule: with case-only mode on and a case size set, quantities move in cases. */
export function incrementFor(p: { unitsPerCase: number | null }, caseOnly: boolean): number {
  return caseOnly && p.unitsPerCase && p.unitsPerCase > 1 ? p.unitsPerCase : 1;
}

export type ProductFacts = {
  id: string;
  sku: string;
  name: string;
  sellUnit: string;
  unitsPerCase: number | null;
  priceMinor: number | null;
  currencyCode: string;
  requiresImportAcknowledgment: boolean;
};

/** Current price, unit and import flag for products (published or not). */
export async function productFacts(db: AnyDb, productIds: string[]): Promise<Map<string, ProductFacts>> {
  const out = new Map<string, ProductFacts>();
  if (productIds.length === 0) return out;
  const rows = await db.select().from(product).where(inArray(product.id, productIds));
  const prices = await latestPriceEpochsByProduct(db, productIds);
  const routeIds = [...prices.values()].map((p) => p.sourcingRouteId).filter((x): x is string => Boolean(x));
  const routes = routeIds.length ? await db.select().from(sourcingRoute).where(inArray(sourcingRoute.id, routeIds)) : [];
  const routeType = new Map(routes.map((r) => [r.id, r.routeType]));
  for (const p of rows) {
    const price = prices.get(p.id);
    out.set(p.id, {
      id: p.id,
      sku: p.sku,
      name: p.name,
      sellUnit: sellUnitOf(p),
      unitsPerCase: p.unitsPerCase ?? null,
      priceMinor: price ? Number(price.priceMinor) : null,
      currencyCode: price?.currencyCode ?? "USD",
      requiresImportAcknowledgment: price?.sourcingRouteId ? routeType.get(price.sourcingRouteId) === "import" : false,
    });
  }
  return out;
}

/**
 * Lowest price a drop may charge for a product: its latest cost plus the
 * markup floor (the route's override, else Settings → Minimum markup), the
 * same rule catalog imports enforce. Null when there's no USD cost on file,
 * so a typed price can't be checked.
 */
export async function priceFloorMinor(db: AnyDb, productId: string): Promise<{ floorMinor: number; floorBps: number } | null> {
  const epoch = (await latestPriceEpochsByProduct(db, [productId])).get(productId);
  if (!epoch || epoch.currencyCode !== "USD" || !(Number(epoch.costMinor) > 0)) return null;
  let floorBps = await getSetting<number>(SETTINGS_KEYS.markupFloorBps, 2800, db);
  if (epoch.sourcingRouteId) {
    const [route] = await db.select().from(sourcingRoute).where(eq(sourcingRoute.id, epoch.sourcingRouteId)).limit(1);
    if (route?.markupFloorBpsOverride != null) floorBps = route.markupFloorBpsOverride;
  }
  return { floorMinor: Math.ceil((Number(epoch.costMinor) * (10_000 + floorBps)) / 10_000), floorBps };
}

// ── Accounts ──────────────────────────────────────────────────────────────

export type AccountFacts = {
  id: string;
  legalName: string;
  kind: "internal" | "external";
  createdAt: Date;
  /** null = may receive offers. */
  ineligibleReason: string | null;
  email: string;
};

export function eligibilityReason(
  acct: { kind: string; taxStatus: string; orderingHoldReason: string | null },
  hasBuyingContact: boolean,
): string | null {
  if (acct.orderingHoldReason) return `On hold: ${acct.orderingHoldReason}`;
  if (!hasBuyingContact) return "No active contact who can buy";
  if (acct.kind === "internal") return null;
  if (acct.taxStatus !== "exempt") return "Needs tax review (resale certificate not verified)";
  return null;
}

export async function accountFacts(db: AnyDb, accountIds?: string[]): Promise<Map<string, AccountFacts>> {
  const rows = accountIds
    ? accountIds.length
      ? await db.select().from(account).where(inArray(account.id, accountIds))
      : []
    : await db.select().from(account);
  const ids = rows.map((r) => r.id);
  const contacts = ids.length ? await db.select().from(accountContact).where(inArray(accountContact.accountId, ids)) : [];
  const buying = new Set(
    contacts.filter((c) => c.active && canOrder(normalizeContactRole(c.roleOnAccount))).map((c) => c.accountId),
  );
  const out = new Map<string, AccountFacts>();
  for (const a of rows) {
    out.set(a.id, {
      id: a.id,
      legalName: a.legalName,
      kind: a.kind,
      createdAt: a.createdAt,
      ineligibleReason: eligibilityReason(a, buying.has(a.id)),
      email: a.primaryContactEmail,
    });
  }
  return out;
}

export async function internalAccountId(db: AnyDb): Promise<string | null> {
  const [row] = await db.select({ id: account.id }).from(account).where(eq(account.kind, "internal")).limit(1);
  return row?.id ?? null;
}

/** Scores for accounts, from the trailing 12 months of invoices, payments and offers. */
export async function scoreAccounts(db: AnyDb, accountIds: string[], now: Date): Promise<Map<string, ScoreDetail>> {
  const out = new Map<string, ScoreDetail>();
  if (accountIds.length === 0) return out;
  const since = new Date(now.getTime() - YEAR_MS);

  const accts = await db.select({ id: account.id, createdAt: account.createdAt }).from(account).where(inArray(account.id, accountIds));
  const invs = await db
    .select()
    .from(invoice)
    .where(and(inArray(invoice.accountId, accountIds), eq(invoice.status, "paid"), gte(invoice.createdAt, since)));
  const invIds = invs.map((i) => i.id);
  const pays = invIds.length ? await db.select().from(payment).where(inArray(payment.invoiceId, invIds)) : [];
  const offers = await db
    .select({ accountId: allocationOffer.accountId, status: allocationOffer.status })
    .from(allocationOffer)
    .where(and(inArray(allocationOffer.accountId, accountIds), gte(allocationOffer.createdAt, since)));

  for (const a of accts) {
    const mine = invs.filter((i) => i.accountId === a.id);
    const spend = mine.reduce((s, i) => s + i.totalMinor, 0);
    const days: number[] = [];
    for (const inv of mine) {
      const cleared = pays
        .filter((p) => p.invoiceId === inv.id && p.fundsClearedAt)
        .map((p) => p.fundsClearedAt!.getTime());
      const start = (inv.sentAt ?? inv.createdAt).getTime();
      if (cleared.length) days.push(Math.max(0, (Math.max(...cleared) - start) / 86_400_000));
    }
    const o = offers.filter((x) => x.accountId === a.id);
    out.set(
      a.id,
      computeScore({
        paidSpendMinor: spend,
        medianPayDays: median(days),
        offersAccepted: o.filter((x) => x.status === "accepted").length,
        offersDeclined: o.filter((x) => x.status === "declined").length,
        offersExpired: o.filter((x) => x.status === "expired").length,
        tenureMonths: wholeMonthsBetween(a.createdAt, now),
      }),
    );
  }
  return out;
}

/** Desired quantity per (account, product). */
export async function interestByProduct(db: AnyDb, productIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (productIds.length === 0) return out;
  const rows = await db.select().from(buyerInterest).where(inArray(buyerInterest.productId, productIds));
  for (const r of rows) {
    const m = out.get(r.productId) ?? new Map<string, number>();
    m.set(r.accountId, r.desiredQty);
    out.set(r.productId, m);
  }
  return out;
}

export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}
