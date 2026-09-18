import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { account } from "./account";
import { product, supplier } from "./catalog";
import { user } from "./user";

/**
 * Batch allocation rounds (fanzia-as-client design doc §2): an explicit
 * round collects buyer requests against a distributor order window, then
 * splits available distributor stock across participants under the
 * fairness policy snapshotted immutably into the round. The internal
 * Fanzia buyer (internalAccountId) participates under the same math —
 * `mode: 'fanzia_first'` fills it first per product.
 *
 * Lifecycle: collecting → allocating → closed → ordered.
 * "ordered" is set after the distributor PO pack for the closed round is
 * placed (a parallel task owns PO packs; see db/schema/distributor.ts).
 * Invoice generation from closed lines is a later phase — closing a round
 * today only records the approved split.
 */
export const allocationRoundStatus = pgEnum("allocation_round_status", [
  "collecting",
  "allocating",
  "closed",
  "ordered",
]);

export const allocationRound = pgTable("allocation_round", {
  id: idColumn(),
  /** Owner-readable window label, e.g. "King Punch October order". */
  name: text("name").notNull(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplier.id),
  /**
   * The internal Fanzia buyer account participating in this round. The
   * engine fills this account's requested qty first per product
   * (fanzia_first policy); the UI badges its rows INTERNAL. NULL = no
   * internal participant this round (externals split everything).
   */
  internalAccountId: uuid("internal_account_id").references(() => account.id),
  status: allocationRoundStatus("status").notNull().default("collecting"),
  /** Requests submitted after this are not allocated; NULL = still open. */
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }),
  /**
   * Immutable fairness policy chosen at round creation from the fixed
   * policy dropdown (lib/allocation/engine.ts ALLOCATION_POLICY_SNAPSHOT).
   * Changing the default policy requires an owner action + audit entry —
   * it is never free text and never edited per round after creation.
   */
  policySnapshot: jsonb("policy_snapshot").notNull(),
  createdBy: uuid("created_by").references(() => user.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
});

export const allocationLineStatus = pgEnum("allocation_line_status", [
  "requested",
  "allocated",
  "closed",
]);

/**
 * One buyer's request for one product in one round. `allocatedQty` is
 * written only by the allocate endpoint (lib/allocation/engine.ts);
 * `status` follows the round: requested → allocated → closed.
 * Buyer rules ($500 min / $5k cap / $25 fee / 48h expiry) live in the
 * order-request/invoicing flow and are untouched by this table.
 */
export const allocationLine = pgTable("allocation_line", {
  id: idColumn(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => allocationRound.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => product.id),
  requestedQty: integer("requested_qty").notNull().default(0),
  allocatedQty: integer("allocated_qty").notNull().default(0),
  status: allocationLineStatus("status").notNull().default("requested"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
