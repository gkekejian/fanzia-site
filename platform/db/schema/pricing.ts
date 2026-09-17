import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { product, sourcingRoute } from "./catalog";
import { currency } from "./currency";
import { user } from "./user";
import { catalogImport } from "./catalogImport";

/**
 * Append-only pricing history (build prompt §11: "preserve prior values and
 * write an audit trail"). Never updated after insert — enforced by a DB
 * trigger (migration 0006) mirroring terms_version's pattern. A price
 * change is always a new row with a later `effectiveAt`; the current price
 * is the latest row by `effectiveAt` for a product (see
 * lib/catalog/queries.ts).
 *
 * `markupBps` and `realizedGrossMarginBps` are stored separately and must
 * never be conflated (build prompt §9 / test gate #6): `markupBps` is what
 * was applied to `costMinor` to reach `priceMinor`; `realizedGrossMarginBps`
 * is the resulting margin, `(price - cost) / price`, always a smaller
 * number than markupBps for any positive cost. See
 * lib/catalog/pricingMath.ts for the two formulas.
 *
 * `costMinor`/`priceMinor` share one `currencyCode` — real FX conversion
 * between a foreign landed cost and a USD buyer price is out of scope for
 * Phase 2 (no FX/landed-cost engine exists yet); import rows are expected
 * to supply cost already in the currency the buyer will be charged.
 */
export const priceEpoch = pgTable("price_epoch", {
  id: idColumn(),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  sourcingRouteId: uuid("sourcing_route_id").references(() => sourcingRoute.id),
  costMinor: bigint("cost_minor", { mode: "number" }).notNull(),
  currencyCode: text("currency_code")
    .notNull()
    .references(() => currency.code),
  markupBps: integer("markup_bps").notNull(),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  realizedGrossMarginBps: integer("realized_gross_margin_bps").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  publishedFromImportId: uuid("published_from_import_id").references(() => catalogImport.id),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
