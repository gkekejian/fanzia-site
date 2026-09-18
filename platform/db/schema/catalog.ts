import { bigint, boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { user } from "./user";
import { currency } from "./currency";

export const routeType = pgEnum("route_type", ["import", "domestic"]);

/**
 * `estimated` is route-level only, before any source_check has ever been
 * recorded against the route (build prompt §10: King Punch DDP/surcharge
 * numbers sit here until written confirmation exists). Once a check
 * happens, the check's own confidence — a narrower enum, see
 * `sourceCheckConfidence` below — governs staleness; this field reflects
 * the route's best confidence to date.
 */
export const routeConfidence = pgEnum("route_confidence", [
  "estimated",
  "observed",
  "quoted",
  "confirmed",
]);

export const routeSourceType = pgEnum("route_source_type", [
  "public_faq",
  "member_page",
  "invoice",
  "broker_entry",
]);

/**
 * Internal only. Supplier identity and terms must never enter a buyer DTO
 * (build prompt §10/§18) — enforced by construction: lib/catalog/dto.ts has
 * no code path that copies a row from this table into a public or member
 * DTO builder; only admin DTO builders with a cost_stack:read check do.
 */
export const supplier = pgTable("supplier", {
  id: idColumn(),
  name: text("name").notNull(),
  notes: text("notes"),
  invoiceDueHours: integer("invoice_due_hours"),
  ...timestamps,
});

export const productStatus = pgEnum("product_status", ["draft", "active", "inactive"]);
export const productCondition = pgEnum("product_condition", ["sealed", "no_shrink"]);

/**
 * Catalog identity and specs — exactly what build prompt §18 says the
 * public catalog may show. Price, availability, supplier, and cost never
 * live on this table; they live on price_epoch / sourcing_route /
 * source_check, which only member- or admin-scoped DTO builders read
 * (lib/catalog/dto.ts). `publiclyVisible` lets an owner stage a product
 * (imported, priced) without it appearing on the public catalog yet.
 */
export const product = pgTable("product", {
  id: idColumn(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  editionLanguage: text("edition_language").notNull(),
  origin: text("origin").notNull(),
  condition: productCondition("condition").notNull(),
  packsPerUnit: integer("packs_per_unit").notNull(),
  cardsPerPack: integer("cards_per_pack"),
  releaseStatus: text("release_status").notNull(),
  descriptionOriginal: text("description_original").notNull(),
  status: productStatus("status").notNull().default("draft"),
  publiclyVisible: boolean("publicly_visible").notNull().default(false),
  /**
   * Manufacturer's suggested retail price per wholesale unit, in minor
   * currency units. NULL = unknown and is never invented. Buyer-facing
   * reference for buyer margin math only — this is not Fanzia cost data
   * and must never be confused with the cost stack (price_epoch).
   */
  msrpMinor: bigint("msrp_minor", { mode: "number" }),
  imageStatus: text("image_status").notNull().default("none"), // none | fanzia_owned | licensed
  ...timestamps,
});

/**
 * A product can be sourced via more than one supplier/route. Markup
 * configuration lives here rather than on `product`, because cost and
 * route type (import vs domestic) drive markup (build prompt §9: 35%
 * import / 17.5% domestic as configurable starting assumptions, overridable
 * per route). `targetMarkupBpsOverride`/`markupFloorBpsOverride` fall back
 * to settings defaults by route type when null — see
 * lib/catalog/pricingMath.ts.
 */
export const sourcingRoute = pgTable("sourcing_route", {
  id: idColumn(),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplier.id),
  routeType: routeType("route_type").notNull(),
  confidence: routeConfidence("confidence").notNull(),
  sourceType: routeSourceType("source_type").notNull(),
  sourceReference: text("source_reference"),
  targetMarkupBpsOverride: integer("target_markup_bps_override"),
  markupFloorBpsOverride: integer("markup_floor_bps_override"),
  active: boolean("active").notNull().default(true),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: uuid("verified_by").references(() => user.id),
  ...timestamps,
});

export const sourceCheckMethod = pgEnum("source_check_method", [
  "member_page",
  "email_quote",
  "phone",
  "supplier_confirmation",
]);

export const sourceCheckConfidence = pgEnum("source_check_confidence", [
  "observed",
  "quoted",
  "confirmed",
]);

/**
 * Build prompt §5, field-for-field: an owner reading a stock figure on a
 * supplier page at a point in time, never a reservation. Append-only —
 * enforced by a DB trigger (migration 0006), mirroring terms_version's
 * pattern — because a check is evidence of what was observed at
 * `checkedAt`; it is superseded by a fresh row, never edited in place.
 * `validUntil` is a policy-set staleness horizon (lib/catalog/staleness.ts),
 * not a supplier promise.
 */
export const sourceCheck = pgTable("source_check", {
  id: idColumn(),
  sourcingRouteId: uuid("sourcing_route_id")
    .notNull()
    .references(() => sourcingRoute.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  checkedBy: uuid("checked_by").references(() => user.id),
  stockObserved: integer("stock_observed"),
  priceObservedMinor: bigint("price_observed_minor", { mode: "number" }).notNull(),
  currencyCode: text("currency_code")
    .notNull()
    .references(() => currency.code),
  method: sourceCheckMethod("method").notNull(),
  confidence: sourceCheckConfidence("confidence").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  evidenceObjectKey: text("evidence_object_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
