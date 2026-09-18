import { bigint, boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { product } from "./catalog";
import { account } from "./account";

/**
 * Nayax vending connector (design doc: fanzia-as-client-design-2026-09-18,
 * §3). Lynx has no webhooks, so sales history is built by polling
 * GET /v1/machines/{id}/lastSales and storing every transaction
 * idempotently (dedupe key: nayax_txn_id). These tables are the internal
 * buyer's view of its own machines — no buyer-facing surface reads them.
 */

export const nayaxMachineLocation = pgEnum("nayax_machine_location", ["glendale", "lakewood"]);

/** A physical vending machine, keyed by Nayax's numeric MachineID. */
export const nayaxMachine = pgTable("nayax_machine", {
  id: idColumn(),
  nayaxMachineId: bigint("nayax_machine_id", { mode: "number" }).notNull().unique(),
  name: text("name").notNull(),
  location: nayaxMachineLocation("location").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/**
 * THE planogram: which platform product sits in which slot (MDB position)
 * of a machine, and how many units a full slot holds. Without this the
 * suggestion engine is blind — Lynx only reports a ProductName string, so
 * every sale is resolved through this map (see lib/nayax/ingest.ts).
 */
export const slotMap = pgTable(
  "slot_map",
  {
    id: idColumn(),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => nayaxMachine.id, { onDelete: "cascade" }),
    slotPosition: integer("slot_position").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    capacityUnits: integer("capacity_units").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  // Composite uniqueness is enforced in the migration (one product per slot
  // per machine); drizzle's unique() on the table builder keeps this file
  // free of index boilerplate.
);

/** One normalized vending sale, from the Lynx API (source='api') or a Nayax
 * Core CSV export (source='csv'). Immutable: rows are inserted once and
 * never updated — a re-import of the same nayax_txn_id is skipped. */
export const nayaxSaleSource = pgEnum("nayax_sale_source", ["api", "csv"]);

export const nayaxSale = pgTable("nayax_sale", {
  id: idColumn(),
  machineId: uuid("machine_id")
    .notNull()
    .references(() => nayaxMachine.id, { onDelete: "cascade" }),
  slotPosition: integer("slot_position"),
  productId: uuid("product_id").references(() => product.id),
  units: integer("units").notNull(),
  /** Minor currency units, as reported by Nayax (AuthorizationValue). */
  amountCents: bigint("amount_cents", { mode: "number" }),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  /** Lynx TransactionID — the idempotency key, globally unique. */
  nayaxTxnId: text("nayax_txn_id").notNull().unique(),
  source: nayaxSaleSource("source").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-product reorder tuning, owner-entered. Defaults keep the engine
 * running for products the owner hasn't tuned yet; see
 * lib/nayax/weekly.ts DEFAULT_PARAMS.
 */
export const restockParams = pgTable("restock_params", {
  id: idColumn(),
  productId: uuid("product_id")
    .notNull()
    .unique()
    .references(() => product.id),
  leadTimeDays: integer("lead_time_days").notNull(),
  safetyStockDays: integer("safety_stock_days").notNull(),
  reviewPeriodDays: integer("review_period_days").notNull(),
  minOrderUnits: integer("min_order_units").notNull(),
  /** Human label for the case SKU suggestions snap up to (e.g. "booster box of 36"). */
  preferredCaseSku: text("preferred_case_sku"),
  /** Units per case — the snap-up divisor in the suggestion algorithm. */
  caseUnits: integer("case_units").notNull(),
  /** Trial quantity for products with no sales history (flagged NEW). */
  trialQty: integer("trial_qty"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/**
 * Append-only restock log. POST /api/admin/nayax/restock ("I restocked
 * machine X") writes one row per slot: unitsRestored is what went INTO the
 * slot (defaults to the slot's capacityUnits). On-hand estimates are
 * unitsRestored minus sales since restockedAt; without a baseline the
 * engine flags 'baseline-unknown' rather than inventing one.
 */
export const nayaxRestock = pgTable("nayax_restock", {
  id: idColumn(),
  machineId: uuid("machine_id")
    .notNull()
    .references(() => nayaxMachine.id, { onDelete: "cascade" }),
  slotPosition: integer("slot_position").notNull(),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id),
  unitsRestored: integer("units_restored").notNull(),
  restockedAt: timestamp("restocked_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid("recorded_by"),
});

/**
 * One engine run per week (weekKey = ISO week, e.g. "2026-W39"). `lines`
 * carries the full line-level math for audit (velocity, on-hand, days of
 * cover, suggested units/cases per SKU per machine).
 */
export const nayaxSuggestionRun = pgTable("nayax_suggestion_run", {
  id: idColumn(),
  weekKey: text("week_key").notNull().unique(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  lines: jsonb("lines").notNull().default([]),
  ...timestamps,
});

export const internalRestockDraftStatus = pgEnum("internal_restock_draft_status", [
  "draft",
  "approved",
  "joined",
  "superseded",
]);

/**
 * The internal buyer's weekly restock request, created/updated by the
 * suggestion engine with source='internal-suggestion' (idempotent per
 * weekKey). A human owner still reviews/approves it. The engine also syncs
 * the suggested quantities into the open allocation round as
 * engine-tagged allocation_line rows (notes carry
 * "source=internal-suggestion week=..."), so the internal request sits
 * alongside external requests under the same allocation math; only the
 * engine's own tagged, still-requested lines are ever updated.
 */
export const internalRestockDraft = pgTable("internal_restock_draft", {
  id: idColumn(),
  weekKey: text("week_key").notNull().unique(),
  source: text("source").notNull().default("internal-suggestion"),
  status: internalRestockDraftStatus("status").notNull().default("draft"),
  buyerAccountId: uuid("buyer_account_id").references(() => account.id),
  /** [{ productId, sku, name, units, cases, caseUnits, estCostMinor, flags, perMachine }] */
  lines: jsonb("lines").notNull().default([]),
  estimatedCostMinor: bigint("estimated_cost_minor", { mode: "number" }),
  notes: text("notes"),
  ...timestamps,
});
