import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { user } from "./user";
import { product } from "./catalog";

export const catalogImportStatus = pgEnum("catalog_import_status", [
  "staged",
  "approved",
  "published",
  "rejected",
]);

export const catalogImportRowDiffType = pgEnum("catalog_import_row_diff_type", [
  "add",
  "price_change",
  "availability_change",
  "missing",
  "unchanged",
  "invalid",
]);

/**
 * Build prompt §11 staged-import flow: upload, parse into staging, match by
 * SKU, show the diff, owner approves, publish only after approval. Nothing
 * in `product`, `sourcing_route`, `price_epoch`, or `source_check` is
 * written by uploading or approving a file — only `publishCatalogImport`
 * (lib/catalog/import/service.ts) writes those tables, and that action is
 * capability-gated behind agent_proposal for ai_operator (lib/auth/rbac.ts).
 */
export const catalogImport = pgTable("catalog_import", {
  id: idColumn(),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => user.id),
  originalFilename: text("original_filename").notNull(),
  fileFormat: text("file_format").notNull(), // csv | xlsx
  status: catalogImportStatus("status").notNull().default("staged"),
  rowCount: integer("row_count").notNull().default(0),
  approvedBy: uuid("approved_by").references(() => user.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => user.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per input line, classified by `diffType` against current live
 * state at staging time. `included` is the owner's per-row approval
 * decision (defaults true, except `invalid` which can never be included and
 * `missing` which defaults false so a file that omits a SKU never silently
 * deactivates it). Re-importing an unchanged file classifies every row
 * `unchanged`, so publish is a no-op for it — no duplicate products or
 * routes are ever created (test gate #14).
 */
export const catalogImportRow = pgTable("catalog_import_row", {
  id: idColumn(),
  catalogImportId: uuid("catalog_import_id")
    .notNull()
    .references(() => catalogImport.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  diffType: catalogImportRowDiffType("diff_type").notNull(),
  stagedData: jsonb("staged_data").notNull(),
  validationErrors: jsonb("validation_errors"),
  matchedProductId: uuid("matched_product_id").references(() => product.id),
  included: boolean("included").notNull().default(true),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
