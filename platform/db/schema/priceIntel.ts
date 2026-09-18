import { bigint, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { numeric } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { product, supplier } from "./catalog";
import { currency } from "./currency";
import { user } from "./user";

/**
 * Supplier price intelligence (W5). Owner-only surface: supplier identity,
 * supplier cost, and markup must never reach a buyer DTO — the same
 * boundary enforced in lib/catalog/dto.ts applies here: no builder in this
 * module touches buyer-facing types.
 *
 * Append-only conventions mirror price_epoch / source_check: supplierPrice
 * and fxRate rows are never updated after insert — enforced by DB triggers
 * in migration 0020 — so price history per supplier×product is a true
 * audit trail. New rows supersede old ones by (validFrom, createdAt).
 */

/**
 * One uploaded distributor price list. The raw file is stored via
 * lib/storage (putObject) and referenced by fileKey; the parsed rows land
 * in supplierPrice with sourceListId pointing back here.
 */
export const supplierPriceList = pgTable("supplier_price_list", {
  id: idColumn(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplier.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: uuid("uploaded_by").references(() => user.id),
  fileKey: text("file_key").notNull(),
  originalFilename: text("original_filename"),
  notes: text("notes"),
  ...timestamps,
});

/**
 * A single supplier unit price for one product, as quoted on a price list
 * or observed by an owner. Append-only: supersede, never mutate
 * (migration 0020 trigger). unitPriceMinor is the per-UNIT price
 * (units defined by product.packsPerUnit, e.g. a booster box).
 */
export const supplierPrice = pgTable("supplier_price", {
  id: idColumn(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplier.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
  currencyCode: text("currency_code")
    .notNull()
    .references(() => currency.code),
  moq: integer("moq"),
  caseSize: integer("case_size"),
  shippingTerms: text("shipping_terms"),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  sourceListId: uuid("source_list_id").references(() => supplierPriceList.id),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shippingRuleType = pgEnum("shipping_rule_type", [
  "flat_per_order",
  "per_case",
  "free_over",
]);

/**
 * Per-supplier shipping rule used by the landed-cost engine
 * (lib/priceIntel/landedCost.ts). One row per supplier, upserted by the
 * owner — this is configuration, not history, so it is mutable.
 */
export const supplierShippingRule = pgTable("supplier_shipping_rule", {
  supplierId: uuid("supplier_id")
    .primaryKey()
    .references(() => supplier.id),
  ruleType: shippingRuleType("rule_type").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }),
  thresholdMinor: bigint("threshold_minor", { mode: "number" }),
  /**
   * Payment-processor fee in basis points assumed for this supplier's
   * landed cost (e.g. PayPal 5% = 500; Wise ≈ 0-50). Owner-set; null =
   * treat as 0.
   */
  paymentFeeBps: integer("payment_fee_bps"),
  updatedBy: uuid("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Manually owner-set FX rates. Append-only (migration 0020 trigger):
 * rate changes are new rows, giving a history of the rate assumed at any
 * point in time. rate is fromCurrency → toCurrency (e.g. JPY→USD).
 */
export const fxRate = pgTable("fx_rate", {
  id: idColumn(),
  fromCurrency: text("from_currency")
    .notNull()
    .references(() => currency.code),
  toCurrency: text("to_currency")
    .notNull()
    .references(() => currency.code),
  rate: numeric("rate", { precision: 20, scale: 8 }).notNull(),
  setBy: uuid("set_by").references(() => user.id),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketPriceSource = pgEnum("market_price_source", ["manual", "ebay_sold"]);

export const marketPriceConfidence = pgEnum("market_price_confidence", ["high", "low"]);

/**
 * A market-price observation for a product: the median of eBay sold
 * listings (source='ebay_sold', written by lib/priceIntel/refresh.ts) or an
 * owner-entered reference price (source='manual', sourceUrl required by the
 * API route). Latest row per product by observedAt is the current market
 * signal; rows are never mutated by refreshes — new observations are new
 * rows. marketPriceMinor is the per-UNIT market price in USD minor.
 */
export const marketPrice = pgTable("market_price", {
  id: idColumn(),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  marketPriceMinor: bigint("market_price_minor", { mode: "number" }).notNull(),
  source: marketPriceSource("source").notNull(),
  sourceUrl: text("source_url"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  sampleSize: integer("sample_size"),
  confidence: marketPriceConfidence("confidence").notNull().default("high"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pricingFlagState = pgEnum("pricing_flag_state", ["estimated", "real"]);

/**
 * Explicit owner flip from catalog ESTIMATED pricing to real pricing
 * (design doc §5 / W5 item 10). Catalog demo rows (KP-, HW-, and TEST-
 * prefixed SKUs) currently carry estimated prices — nothing auto-flips
 * them in v1.
 * Set only by the owner-only "mark real" action, audit-logged with the
 * actor; a row here with isReal='real' means the owner has verified the
 * product's price stack.
 */
export const productPricingFlag = pgTable("product_pricing_flag", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => product.id, { onDelete: "cascade" }),
  isReal: pricingFlagState("is_real").notNull().default("estimated"),
  setBy: uuid("set_by").references(() => user.id),
  setAt: timestamp("set_at", { withTimezone: true }),
  notes: text("notes"),
});
