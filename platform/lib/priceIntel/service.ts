import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import {
  fxRate,
  marketPrice,
  productPricingFlag,
  supplierPrice,
  supplierPriceList,
} from "@/db/schema/priceIntel";
import { product, supplier } from "@/db/schema/catalog";
import { currency } from "@/db/schema/currency";
import { putObject } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/rbac";
import { actorUserId } from "@/lib/auth/rbac";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export const MAX_PRICE_LIST_BYTES = 5 * 1024 * 1024;

/**
 * CSV template (documented here and in the upload route). One row per
 * product. unit_price is in MAJOR currency units (e.g. 145.00 USD, 1500 JPY)
 * and is converted to minor units using the currency table's exponent.
 *
 * sku,unit_price,currency,moq,case_size,shipping_terms,valid_from,notes
 * KP-001,1500,JPY,10,36,DDP air freight,2026-09-18,September price list
 * HW-002,145.00,USD,5,12,,2026-09-18,
 *
 * sku must match a product.sku exactly (case-sensitive). currency must be
 * a seeded currency code. moq/case_size are integers when present.
 * valid_from is YYYY-MM-DD (defaults to now). notes is free text.
 */
export type ParsedPriceRow = {
  rowNumber: number;
  sku: string;
  productId: string;
  unitPriceMinor: number;
  currencyCode: string;
  moq: number | null;
  caseSize: number | null;
  shippingTerms: string | null;
  validFrom: Date;
  notes: string | null;
};

/** Minimal CSV parser: commas, quoted fields, embedded quotes (""). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // ignore; \n handles the line break
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function parsePriceListCsv(
  buffer: Buffer,
  db: AnyDb = defaultDb,
): Promise<ParsedPriceRow[]> {
  if (buffer.length > MAX_PRICE_LIST_BYTES) {
    throw new ValidationError("File exceeds the 5MB price-list size limit.");
  }
  const text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    throw new ValidationError("File must be plain UTF-8 CSV (BOM not supported).");
  }
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ValidationError("CSV is empty.");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const required = ["sku", "unit_price", "currency"];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new ValidationError(`CSV is missing required column "${col}".`);
    }
  }
  const idx = (name: string) => header.indexOf(name);
  const col = (r: string[], name: string) => {
    const i = idx(name);
    return i === -1 ? "" : (r[i] ?? "").trim();
  };

  const currencies = await db.select().from(currency);
  const exponentByCode = new Map(currencies.map((c) => [c.code, c.exponent]));
  const products = await db.select().from(product);
  const idBySku = new Map(products.map((p) => [p.sku, p.id]));

  const out: ParsedPriceRow[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const sku = col(r, "sku");
    if (!sku) throw new ValidationError(`Row ${rowNumber}: sku is required.`);
    const productId = idBySku.get(sku);
    if (!productId) {
      throw new ValidationError(`Row ${rowNumber}: sku "${sku}" does not match any product.`);
    }
    const currencyCode = col(r, "currency").toUpperCase();
    const exponent = exponentByCode.get(currencyCode);
    if (exponent === undefined) {
      throw new ValidationError(`Row ${rowNumber}: unknown currency "${currencyCode}".`);
    }
    const priceMajor = col(r, "unit_price");
    if (!/^\d+(\.\d{1,8})?$/.test(priceMajor)) {
      throw new ValidationError(`Row ${rowNumber}: unit_price "${priceMajor}" is not a valid amount.`);
    }
    const unitPriceMinor = Math.round(parseFloat(priceMajor) * Math.pow(10, exponent));
    const intOrNull = (name: string): number | null => {
      const v = col(r, name);
      if (!v) return null;
      if (!/^\d+$/.test(v)) {
        throw new ValidationError(`Row ${rowNumber}: ${name} "${v}" must be an integer.`);
      }
      return parseInt(v, 10);
    };
    const validFromRaw = col(r, "valid_from");
    const validFrom = validFromRaw ? new Date(`${validFromRaw}T00:00:00Z`) : new Date();
    if (!Number.isFinite(validFrom.getTime())) {
      throw new ValidationError(`Row ${rowNumber}: valid_from "${validFromRaw}" is not YYYY-MM-DD.`);
    }
    out.push({
      rowNumber,
      sku,
      productId,
      unitPriceMinor,
      currencyCode,
      moq: intOrNull("moq"),
      caseSize: intOrNull("case_size"),
      shippingTerms: col(r, "shipping_terms") || null,
      validFrom,
      notes: col(r, "notes") || null,
    });
  });
  if (out.length === 0) throw new ValidationError("CSV has no data rows.");
  return out;
}

export async function applySupplierPriceUpload(
  input: {
    actor: Actor;
    supplierId: string;
    /** Pre-parsed rows (from prepareSupplierPriceUpload). */
    rows: Omit<ParsedPriceRow, "rowNumber">[];
    fileKey: string;
    originalFilename: string;
    notes?: string;
  },
  db: AnyDb = defaultDb,
): Promise<{ listId: string; rowCount: number }> {
  const supplierRows = await db.select().from(supplier);
  if (!supplierRows.some((s) => s.id === input.supplierId)) {
    throw new NotFoundError("Supplier not found.");
  }

  const [list] = await db
    .insert(supplierPriceList)
    .values({
      supplierId: input.supplierId,
      uploadedBy: actorUserId(input.actor),
      fileKey: input.fileKey,
      originalFilename: input.originalFilename.slice(0, 200),
      notes: input.notes ?? null,
    })
    .returning();
  if (!list) throw new Error("Failed to create supplier_price_list row.");

  await db.insert(supplierPrice).values(
    input.rows.map((r) => ({
      supplierId: input.supplierId,
      productId: r.productId,
      unitPriceMinor: r.unitPriceMinor,
      currencyCode: r.currencyCode,
      moq: r.moq,
      caseSize: r.caseSize,
      shippingTerms: r.shippingTerms,
      validFrom: r.validFrom instanceof Date ? r.validFrom : new Date(r.validFrom),
      sourceListId: list.id,
      createdBy: actorUserId(input.actor),
    })),
  );

  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "price_intel.price_upload.applied",
      entityType: "supplier_price_list",
      entityId: list.id,
      after: {
        supplierId: input.supplierId,
        rowCount: input.rows.length,
        filename: input.originalFilename,
      },
    },
    db,
  );
  return { listId: list.id, rowCount: input.rows.length };
}

/**
 * Validates and parses the CSV and stores the raw file as an artifact —
 * safe for both owner and ai_operator to run directly (it writes no live
 * price rows). Returns the parsed rows + fileKey, which the caller passes
 * to performOrPropose("price_intel.price_update") so the price writes
 * themselves go through the agent-proposal gate for the agent path.
 */
export async function prepareSupplierPriceUpload(
  input: {
    supplierId: string;
    buffer: Buffer;
    originalFilename: string;
  },
  db: AnyDb = defaultDb,
): Promise<{ rows: ParsedPriceRow[]; fileKey: string }> {
  const rows = await parsePriceListCsv(input.buffer, db);
  const { key } = await putObject(input.buffer);
  return { rows, fileKey: key };
}

export async function setFxRate(
  input: {
    actor: Actor;
    fromCurrency: string;
    toCurrency: string;
    rate: number;
  },
  db: AnyDb = defaultDb,
): Promise<{ id: string }> {
  const { fromCurrency, toCurrency, rate } = input;
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
    throw new ValidationError("Currency codes must be 3 uppercase letters.");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ValidationError("Rate must be a positive number.");
  }
  const [row] = await db
    .insert(fxRate)
    .values({
      fromCurrency,
      toCurrency,
      rate: String(rate),
      setBy: actorUserId(input.actor),
    })
    .returning();
  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "price_intel.fx_rate.set",
      entityType: "fx_rate",
      entityId: row!.id,
      after: { fromCurrency, toCurrency, rate },
    },
    db,
  );
  return { id: row!.id };
}

export async function setMarketPrice(
  input: {
    actor: Actor;
    productId: string;
    marketPriceMinor: number;
    sourceUrl: string;
    notes?: string;
  },
  db: AnyDb = defaultDb,
): Promise<{ id: string }> {
  if (!Number.isInteger(input.marketPriceMinor) || input.marketPriceMinor <= 0) {
    throw new ValidationError("marketPriceMinor must be a positive integer (USD minor).");
  }
  if (!/^https?:\/\//.test(input.sourceUrl)) {
    throw new ValidationError("sourceUrl is required and must be an http(s) URL.");
  }
  const products = await db.select().from(product);
  if (!products.some((p) => p.id === input.productId)) {
    throw new NotFoundError("Product not found.");
  }
  const [row] = await db
    .insert(marketPrice)
    .values({
      productId: input.productId,
      marketPriceMinor: input.marketPriceMinor,
      source: "manual",
      sourceUrl: input.sourceUrl,
      sampleSize: 1,
      confidence: "high",
      notes: input.notes ?? null,
      createdBy: actorUserId(input.actor),
    })
    .returning();
  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "price_intel.market_price.set",
      entityType: "market_price",
      entityId: row!.id,
      after: {
        productId: input.productId,
        marketPriceMinor: input.marketPriceMinor,
        sourceUrl: input.sourceUrl,
      },
    },
    db,
  );
  return { id: row!.id };
}

/**
 * Explicit owner flip from ESTIMATED to real pricing for one product
 * (W5 item 10). Upsert: a missing row implies 'estimated'; setting
 * 'real' requires an explicit, audited action. Nothing auto-flips in v1.
 */
export async function markPricingReal(
  input: { actor: Actor; productId: string; notes?: string },
  db: AnyDb = defaultDb,
): Promise<void> {
  const products = await db.select().from(product);
  const p = products.find((x) => x.id === input.productId);
  if (!p) throw new NotFoundError("Product not found.");
  const existing = await db
    .select()
    .from(productPricingFlag)
    .where(eq(productPricingFlag.productId, input.productId));
  const before = existing[0]?.isReal ?? "estimated";
  await db
    .insert(productPricingFlag)
    .values({
      productId: input.productId,
      isReal: "real",
      setBy: actorUserId(input.actor),
      setAt: new Date(),
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: productPricingFlag.productId,
      set: {
        isReal: "real",
        setBy: actorUserId(input.actor),
        setAt: new Date(),
        notes: input.notes ?? null,
      },
    });
  await recordAudit(
    {
      actorUserId: actorUserId(input.actor),
      actorRole: input.actor.kind,
      actorType: input.actor.kind,
      action: "price_intel.pricing.mark_real",
      entityType: "product_pricing_flag",
      entityId: input.productId,
      before: { isReal: before },
      after: { isReal: "real" },
    },
    db,
  );
}
