import { jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { supplier } from "./catalog";
import { product } from "./catalog";
import { user } from "./user";

/**
 * Distributor-facing SKU/UPC mapping for the PO pack generator
 * (design doc §5: "distributor_skus" mapping table).
 *
 * Each distributor (reusing the `supplier` table as the distributor
 * entity) identifies our platform products by their own SKU and UPC.
 * Populated once per distributor during onboarding. The PO pack pulls
 * from this table; products without a row here are NOT errors — they
 * are flagged as warnings in the generated pack (the order must not be
 * silently shorted) and the distributor SKU falls back to the platform
 * SKU on the line sheet.
 */
export const distributorSku = pgTable(
  "distributor_sku",
  {
    id: idColumn(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => supplier.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    distributorSku: text("distributor_sku"),
    upc: text("upc"),
    ...timestamps,
  },
  (t) => [unique("distributor_sku_supplier_product_uniq").on(t.supplierId, t.productId)],
);

export const poPackStatus = pgEnum("po_pack_status", ["generated", "ordered"]);

/**
 * Stored PO pack artifact: one row per closed allocation round per
 * supplier (design doc §5). `payload` is the full pack JSON produced by
 * lib/po/pack.ts buildPoPack. `roundId` is a free-text reference because
 * the allocation_rounds table is owned by a parallel build task; when it
 * lands, this can become a real FK without changing the API contract.
 *
 * NEVER an auto-submit trigger: rows only exist for packs a human owner
 * generated, and "ordered" is set only by an explicit owner action on
 * the mark-ordered endpoint. No code path in this app places an order
 * with a distributor.
 */
export const poPack = pgTable("po_pack", {
  id: idColumn(),
  roundId: text("round_id").notNull(),
  roundRef: text("round_ref").notNull(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplier.id),
  status: poPackStatus("status").notNull().default("generated"),
  payload: jsonb("payload").notNull(),
  confirmationNumbers: jsonb("confirmation_numbers"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => user.id),
  ...timestamps,
});
