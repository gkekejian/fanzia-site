import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, ilike } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { catalogImport, catalogImportRow, product, supplier, sourcingRoute, priceEpoch, sourceCheck } from "@/db/schema";
import { performOrPropose, actorUserId, type Actor } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { parseCatalogFile, MAX_IMPORT_BYTES, InvalidImportFileError } from "./parse";
import { computeDiff, effectiveMarkupFloorBps } from "./diff";
import { priceFromCostAndMarkup, realizedGrossMarginBps, isBelowMarkupFloor } from "../pricingMath";
import { computeValidUntil } from "../staleness";
import type { CatalogImportRowInput } from "./rowSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

type StagedRowData = CatalogImportRowInput & {
  matchedSupplierId: string | null;
  matchedRouteId: string | null;
  proposedMarkupBps: number;
};

export { InvalidImportFileError, MAX_IMPORT_BYTES };

/**
 * Step 1 of build prompt §11's flow: upload → parse → stage → diff.
 * Uploading and staging never writes `product`, `sourcing_route`,
 * `price_epoch`, or `source_check` — nothing here is a restricted action,
 * so both owner and ai_operator execute it directly (audited).
 */
export async function stageCatalogImport(
  input: { actor: Actor; filename: string; buffer: Buffer },
  db: AnyDb = defaultDb,
) {
  if (input.buffer.length > MAX_IMPORT_BYTES) {
    throw new ValidationError("File exceeds the 5MB import size limit.");
  }
  const { rows, format } = parseCatalogFile(input.buffer, input.filename);

  const [imp] = await db
    .insert(catalogImport)
    .values({
      uploadedBy: actorUserId(input.actor),
      originalFilename: input.filename.slice(0, 200),
      fileFormat: format,
      status: "staged",
      rowCount: rows.length,
    })
    .returning();

  const diffRows = await computeDiff(db, rows);
  if (diffRows.length > 0) {
    await db.insert(catalogImportRow).values(
      diffRows.map((r) => ({
        catalogImportId: imp!.id,
        rowNumber: r.rowNumber,
        diffType: r.diffType,
        stagedData: r.stagedData,
        validationErrors: r.validationErrors,
        matchedProductId: r.matchedProductId,
        included: r.included,
      })),
    );
  }

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "catalog_import.staged",
      entityType: "catalog_import",
      entityId: imp!.id,
      after: { filename: input.filename, rowCount: rows.length },
    },
    db,
  );

  return imp!;
}

async function getImportOrThrow(db: AnyDb, importId: string) {
  const [imp] = await db.select().from(catalogImport).where(eq(catalogImport.id, importId)).limit(1);
  if (!imp) throw new NotFoundError("Catalog import not found");
  return imp;
}

export async function getCatalogImportWithRows(importId: string, db: AnyDb = defaultDb) {
  const imp = await getImportOrThrow(db, importId);
  const rows = await db.select().from(catalogImportRow).where(eq(catalogImportRow.catalogImportId, importId));
  return { import: imp, rows };
}

/** Toggling which rows count is staging-side review, not a live-data change — never restricted. Locked once approved. */
export async function setCatalogImportRowIncluded(
  input: { importId: string; rowId: string; included: boolean; actor: Actor },
  db: AnyDb = defaultDb,
) {
  const imp = await getImportOrThrow(db, input.importId);
  if (imp.status !== "staged") throw new ValidationError("Rows can only be toggled while the import is staged.");

  const [row] = await db
    .select()
    .from(catalogImportRow)
    .where(and(eq(catalogImportRow.id, input.rowId), eq(catalogImportRow.catalogImportId, input.importId)))
    .limit(1);
  if (!row) throw new NotFoundError("Row not found");
  if (row.diffType === "invalid") throw new ValidationError("An invalid row can never be included.");

  const [updated] = await db
    .update(catalogImportRow)
    .set({ included: input.included })
    .where(eq(catalogImportRow.id, row.id))
    .returning();
  return updated!;
}

/**
 * Owner sign-off on the row selection (build prompt §11: "owner approves
 * the diff"). Still writes nothing to live catalog tables — publish is the
 * only step that does — so this is not restricted either.
 */
export async function approveCatalogImport(input: { importId: string; actor: Actor }, db: AnyDb = defaultDb) {
  const imp = await getImportOrThrow(db, input.importId);
  if (imp.status !== "staged") throw new ValidationError("Only a staged import can be approved.");

  const [updated] = await db
    .update(catalogImport)
    .set({ status: "approved", approvedBy: actorUserId(input.actor), approvedAt: new Date() })
    .where(eq(catalogImport.id, input.importId))
    .returning();

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "catalog_import.approved",
      entityType: "catalog_import",
      entityId: input.importId,
    },
    db,
  );
  return updated!;
}

export async function rejectCatalogImport(input: { importId: string; actor: Actor }, db: AnyDb = defaultDb) {
  const imp = await getImportOrThrow(db, input.importId);
  if (imp.status === "published") throw new ValidationError("A published import cannot be rejected.");

  const [updated] = await db
    .update(catalogImport)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(eq(catalogImport.id, input.importId))
    .returning();

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "catalog_import.rejected",
      entityType: "catalog_import",
      entityId: input.importId,
    },
    db,
  );
  return updated!;
}

/**
 * The only step that writes `product`, `sourcing_route`, `price_epoch`, or
 * `source_check` — build prompt §11: "Publish a new price epoch only after
 * approval." Gated by performOrPropose behind agent_proposal for
 * ai_operator (RESTRICTED_ACTIONS in lib/auth/rbac.ts). Re-running publish
 * on rows already applied is impossible by construction: publish requires
 * status 'approved' and flips to 'published' in the same call, and
 * unchanged rows never write anything (test gate #14/#15).
 */
export async function publishCatalogImport(input: { importId: string; actor: Actor }, db: AnyDb = defaultDb) {
  return performOrPropose(
    input.actor,
    "catalog_import.publish",
    { type: "catalog_import", id: input.importId },
    { importId: input.importId },
    async () => {
      const imp = await getImportOrThrow(db, input.importId);
      if (imp.status !== "approved") throw new ValidationError("Only an approved import can be published.");

      const rows = await db
        .select()
        .from(catalogImportRow)
        .where(and(eq(catalogImportRow.catalogImportId, input.importId), eq(catalogImportRow.included, true)));

      for (const row of rows) {
        if (row.diffType === "invalid" || row.diffType === "unchanged") continue;

        if (row.diffType === "missing") {
          if (row.matchedProductId) {
            await db.update(product).set({ status: "inactive" }).where(eq(product.id, row.matchedProductId));
          }
          await db.update(catalogImportRow).set({ appliedAt: new Date() }).where(eq(catalogImportRow.id, row.id));
          continue;
        }

        const staged = row.stagedData as StagedRowData;

        if (row.diffType === "add" || row.diffType === "price_change") {
          // Defensive floor re-check before ANY live-table write: computeDiff
          // marks below-floor rows invalid so they can never be included, but
          // a price epoch must never be written below the floor no matter how
          // the staged row got here. The row is skipped — never silently
          // repriced — and no product/route/price is created for it.
          let floorRoute: { markupFloorBpsOverride: number | null } | null = null;
          if (staged.matchedRouteId) {
            const [rr] = await db
              .select()
              .from(sourcingRoute)
              .where(eq(sourcingRoute.id, staged.matchedRouteId))
              .limit(1);
            floorRoute = rr ?? null;
          }
          const floorBps = await effectiveMarkupFloorBps(floorRoute, db);
          if (isBelowMarkupFloor(staged.proposedMarkupBps, floorBps)) {
            await db
              .update(catalogImportRow)
              .set({
                included: false,
                validationErrors: [
                  `markup_bps ${staged.proposedMarkupBps} is below the markup floor (${floorBps} bps) — row skipped at publish.`,
                ],
              })
              .where(eq(catalogImportRow.id, row.id));
            continue;
          }
        }

        let productId = row.matchedProductId;
        if (!productId) {
          const [existing] = await db.select().from(product).where(eq(product.sku, staged.sku)).limit(1);
          if (existing) {
            productId = existing.id;
          } else {
            const [newProduct] = await db
              .insert(product)
              .values({
                sku: staged.sku,
                name: staged.name,
                editionLanguage: staged.edition_language,
                origin: staged.origin,
                condition: staged.condition,
                packsPerUnit: staged.packs_per_unit,
                cardsPerPack: staged.cards_per_pack ?? null,
                releaseStatus: staged.release_status,
                descriptionOriginal: staged.description,
                status: "active",
                publiclyVisible: true,
              })
              .returning();
            productId = newProduct!.id;
          }
        }

        let supplierId = staged.matchedSupplierId ?? undefined;
        if (!supplierId) {
          const [existingSupplier] = await db
            .select()
            .from(supplier)
            .where(ilike(supplier.name, staged.supplier_name))
            .limit(1);
          if (existingSupplier) {
            supplierId = existingSupplier.id;
          } else {
            const [newSupplier] = await db.insert(supplier).values({ name: staged.supplier_name }).returning();
            supplierId = newSupplier!.id;
          }
        }

        let routeId = staged.matchedRouteId ?? undefined;
        if (!routeId) {
          const [newRoute] = await db
            .insert(sourcingRoute)
            .values({
              productId,
              supplierId,
              routeType: staged.route_type,
              confidence: staged.stock_observed !== undefined ? "observed" : "estimated",
              sourceType: "member_page",
              targetMarkupBpsOverride: staged.markup_bps_override ?? null,
              verifiedBy: actorUserId(input.actor),
              verifiedAt: new Date(),
            })
            .returning();
          routeId = newRoute!.id;
        }

        if (row.diffType === "add" || row.diffType === "price_change") {
          const markupBps = staged.proposedMarkupBps;
          const priceMinor = priceFromCostAndMarkup(staged.cost_minor, markupBps);
          const marginBps = realizedGrossMarginBps(staged.cost_minor, priceMinor);
          await db.insert(priceEpoch).values({
            productId,
            sourcingRouteId: routeId,
            costMinor: staged.cost_minor,
            currencyCode: staged.currency_code,
            markupBps,
            priceMinor,
            realizedGrossMarginBps: marginBps,
            publishedFromImportId: input.importId,
            createdBy: actorUserId(input.actor),
          });
        }

        if (staged.stock_observed !== undefined && (row.diffType === "availability_change" || row.diffType === "add")) {
          const checkedAt = new Date();
          const confidence = staged.check_confidence ?? "observed";
          const validUntil = await computeValidUntil(confidence, checkedAt, db);
          await db.insert(sourceCheck).values({
            sourcingRouteId: routeId,
            checkedAt,
            checkedBy: actorUserId(input.actor),
            stockObserved: staged.stock_observed,
            priceObservedMinor: staged.cost_minor,
            currencyCode: staged.currency_code,
            method: staged.check_method ?? "member_page",
            confidence,
            validUntil,
            evidenceObjectKey: staged.evidence_reference ?? null,
          });
          await db.update(sourcingRoute).set({ confidence }).where(eq(sourcingRoute.id, routeId));
        }

        await db
          .update(catalogImportRow)
          .set({ appliedAt: new Date(), matchedProductId: productId })
          .where(eq(catalogImportRow.id, row.id));
      }

      const [updated] = await db
        .update(catalogImport)
        .set({ status: "published", publishedBy: actorUserId(input.actor), publishedAt: new Date() })
        .where(eq(catalogImport.id, input.importId))
        .returning();
      return updated!;
    },
    db,
  );
}
