/**
 * PO pack generator — pure functions (design doc §5 "Distributor-order bridge").
 *
 * Turns one CLOSED allocation round's consolidated lines for one supplier
 * into a supplier-facing order pack: line items keyed by the distributor's
 * own SKU/UPC (via the distributor_sku mapping), a portal-importable CSV,
 * and a print-friendly HTML PO document.
 *
 * Purity contract: no DB, no network, no filesystem. The API routes
 * fetch data and store artifacts; this module only transforms.
 *
 * Safety: this module can never submit an order. It produces documents
 * a human places through the distributor's own channel.
 */

export interface PoPackRound {
  /** Stable round identifier (text ref; allocation_rounds table is a parallel task). */
  id: string;
  /** Human label, e.g. "King Punch October order". */
  ref: string;
}

export interface PoPackLineInput {
  productId: string;
  platformSku: string;
  productName: string;
  /** Total cases ordered from this supplier for this round. */
  qtyCases: number;
  /** Total loose units ordered (cases × packs/case + extras); must equal internalQtyUnits + customerQtyUnits. */
  qtyUnits: number;
  /** Units destined for Fanzia vending restock (internal buyer allocation). */
  internalQtyUnits: number;
  /** Units destined for external customer fulfillment. */
  customerQtyUnits: number;
}

export interface DistributorSkuMapping {
  productId: string;
  distributorSku: string | null;
  upc: string | null;
}

export interface PoPackSupplier {
  id: string;
  name: string;
  /** Optional human note shown on the PO, e.g. lead time. */
  notes?: string | null;
}

export interface PoPackItem {
  productId: string;
  platformSku: string;
  productName: string;
  /** Distributor's own SKU, or the platform SKU as fallback when unmapped. */
  distributorSku: string;
  upc: string | null;
  qtyCases: number;
  qtyUnits: number;
  internalQtyUnits: number;
  customerQtyUnits: number;
  /** "of which 48 internal vending" memo — distributors don't care, our receiving does. */
  memo: string | null;
  mappingWarning: boolean;
}

export interface PoPack {
  roundId: string;
  roundRef: string;
  supplierId: string;
  supplierName: string;
  generatedAt: string;
  items: PoPackItem[];
  warnings: string[];
  totals: { qtyCases: number; qtyUnits: number; internalQtyUnits: number; customerQtyUnits: number };
}

export function buildPoPack(args: {
  round: PoPackRound;
  lines: PoPackLineInput[];
  distributorSkus: DistributorSkuMapping[];
  supplier: PoPackSupplier;
  generatedAt?: Date;
}): PoPack {
  const { round, lines, distributorSkus, supplier } = args;
  const mappingByProduct = new Map(distributorSkus.map((m) => [m.productId, m]));

  const items: PoPackItem[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const mapping = mappingByProduct.get(line.productId);
    const mappedSku = mapping?.distributorSku?.trim() || null;
    const upc = mapping?.upc?.trim() || null;
    const missing = !mappedSku;
    if (missing) {
      warnings.push(
        `No distributor SKU mapped for ${line.platformSku} (${line.productName}) — using platform SKU as fallback.`,
      );
    }

    let memo: string | null = null;
    if (line.internalQtyUnits > 0) {
      memo = `of which ${line.internalQtyUnits} internal vending`;
    }

    items.push({
      productId: line.productId,
      platformSku: line.platformSku,
      productName: line.productName,
      distributorSku: mappedSku ?? line.platformSku,
      upc,
      qtyCases: line.qtyCases,
      qtyUnits: line.qtyUnits,
      internalQtyUnits: line.internalQtyUnits,
      customerQtyUnits: line.customerQtyUnits,
      memo,
      mappingWarning: missing,
    });
  }

  const totals = items.reduce(
    (acc, i) => ({
      qtyCases: acc.qtyCases + i.qtyCases,
      qtyUnits: acc.qtyUnits + i.qtyUnits,
      internalQtyUnits: acc.internalQtyUnits + i.internalQtyUnits,
      customerQtyUnits: acc.customerQtyUnits + i.customerQtyUnits,
    }),
    { qtyCases: 0, qtyUnits: 0, internalQtyUnits: 0, customerQtyUnits: 0 },
  );

  return {
    roundId: round.id,
    roundRef: round.ref,
    supplierId: supplier.id,
    supplierName: supplier.name,
    generatedAt: (args.generatedAt ?? new Date()).toISOString(),
    items,
    warnings,
    totals,
  };
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV for distributor portal import / manual entry.
 * Columns: distributor SKU, qty in cases, qty in units, UPC, platform SKU
 * (for our own reconciliation), product name, internal memo.
 */
export function toCsv(pack: PoPack): string {
  const header = ["SKU", "qty_cases", "qty_units", "UPC", "platform_sku", "product_name", "memo"];
  const rows = pack.items.map((i) =>
    [i.distributorSku, i.qtyCases, i.qtyUnits, i.upc ?? "", i.platformSku, i.productName, i.memo ?? ""]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Print-friendly standalone HTML PO document. No PDF library — the
 * browser's print-to-PDF is the v1 artifact. Account header, line
 * items, round reference, mapping warnings, totals, and a confirmation
 * block the owner fills in after placing the order by hand.
 */
export function toPrintableHtml(pack: PoPack): string {
  const rows = pack.items
    .map(
      (i, n) => `<tr>
        <td>${n + 1}</td>
        <td>${htmlEscape(i.distributorSku)}${i.mappingWarning ? " <span class=\"warn-flag\">(unmapped — platform SKU)</span>" : ""}</td>
        <td>${htmlEscape(i.productName)}<br><span class="muted">platform SKU: ${htmlEscape(i.platformSku)}</span></td>
        <td>${i.upc ? htmlEscape(i.upc) : "—"}</td>
        <td class="num">${i.qtyCases}</td>
        <td class="num">${i.qtyUnits}</td>
        <td>${i.memo ? htmlEscape(i.memo) : "—"}</td>
      </tr>`,
    )
    .join("");

  const warnings = pack.warnings.length
    ? `<div class="warnings"><strong>Mapping warnings (${pack.warnings.length}):</strong><ul>${pack.warnings.map((w) => `<li>${htmlEscape(w)}</li>`).join("")}</ul></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Purchase Order — ${htmlEscape(pack.supplierName)} — ${htmlEscape(pack.roundRef)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 2rem; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .meta { color: #555; font-size: 0.9rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { border: 1px solid #ccc; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  td.num { text-align: right; }
  .muted { color: #777; font-size: 0.8rem; }
  .warnings { background: #fff8e1; border: 1px solid #e6c200; padding: 0.8rem 1rem; margin: 1.2rem 0; font-size: 0.9rem; }
  .warn-flag { color: #8a6d00; font-size: 0.8rem; }
  .totals { margin-top: 1rem; font-size: 0.95rem; }
  .confirm { margin-top: 2rem; border-top: 2px solid #111; padding-top: 1rem; font-size: 0.9rem; }
  .confirm .line { margin: 0.6rem 0; }
  @media print { body { margin: 0.5in; } .warnings { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<h1>Purchase Order</h1>
<div class="meta">
  <div><strong>Distributor:</strong> ${htmlEscape(pack.supplierName)}</div>
  <div><strong>Round:</strong> ${htmlEscape(pack.roundRef)} <span class="muted">(${htmlEscape(pack.roundId)})</span></div>
  <div><strong>Generated:</strong> ${htmlEscape(pack.generatedAt)}</div>
  <div><strong>Issued by:</strong> Fanzia, Inc.</div>
</div>
${warnings}
<table>
  <thead><tr>
    <th>#</th><th>Distributor SKU</th><th>Product</th><th>UPC</th>
    <th>Cases</th><th>Units</th><th>Memo (internal use)</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <strong>Totals:</strong> ${pack.totals.qtyCases} cases / ${pack.totals.qtyUnits} units
  (${pack.totals.internalQtyUnits} units internal vending, ${pack.totals.customerQtyUnits} units customer fulfillment)
</div>
<div class="confirm">
  <div><strong>Placed by hand — no auto-submission.</strong> This PO was entered manually in the distributor's own channel.</div>
  <div class="line">Distributor confirmation #: ______________________________</div>
  <div class="line">Placed on: ______________ &nbsp; Placed by: ______________</div>
</div>
</body>
</html>`;
}

export type SupplierSuggestionSource = "landed_cost" | "round_fallback";

export interface SupplierSuggestion {
  supplierId: string;
  source: SupplierSuggestionSource;
  note: string;
}

/**
 * Supplier suggestion hook. The landed-cost engine (parallel build at
 * lib/priceIntel/landedCost.ts) may not exist yet when this ships, so the
 * import is dynamic and wrapped: if the module is absent (or its API
 * doesn't match), we fall back to the round's supplier. Callers may let
 * the owner override the suggestion — overrides must be audit-logged via
 * logSupplierOverride().
 */
export async function suggestSupplierFor(
  productId: string,
  qty: number,
  fallbackSupplierId: string,
): Promise<SupplierSuggestion> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import("../priceIntel/landedCost");
    const fn =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (typeof mod.suggestSupplierFor === "function" && mod.suggestSupplierFor) ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (typeof mod.suggestSupplier === "function" && mod.suggestSupplier);
    if (typeof fn === "function") {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = (await fn(productId, qty)) as
        | string
        | { supplierId?: string }
        | null
        | undefined;
      const suggested =
        typeof result === "string" ? result : result?.supplierId;
      if (typeof suggested === "string" && suggested.length > 0) {
        return { supplierId: suggested, source: "landed_cost", note: "Landed-cost engine recommendation" };
      }
    }
  } catch {
    // Module absent or unusable — fall through to the round fallback.
  }
  return {
    supplierId: fallbackSupplierId,
    source: "round_fallback",
    note: "Landed-cost engine unavailable; using the round's supplier",
  };
}
