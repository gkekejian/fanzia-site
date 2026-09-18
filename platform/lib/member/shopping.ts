/**
 * lib/member/shopping.ts — buyer shopping-experience logic (UX brief 2026-09-18).
 *
 * Every function here is pure (no I/O, no secrets) so it is trivially
 * unit-testable and safe to call from client components. Buyer invariants
 * are enforced structurally: nothing in this module touches supplier
 * identity, supplier terms, internal cost, or Fanzia markup — those never
 * enter the buyer DTO boundary (lib/catalog/dto.ts).
 *
 * All money is integer minor units (cents); formatting happens via
 * lib/format.ts's formatMoney at the call site.
 */
import {
  ORDER_MINIMUM_MINOR,
  SMALL_ORDER_FEE_MINOR,
  SMALL_ORDER_THRESHOLD_MINOR,
} from "@/lib/invoicing/rules";

export const LOW_STOCK_THRESHOLD = 5;
export const CURATED_ROW_MAX = 8;
export const SHIPPING_ESTIMATE_LOW_MINOR = 1500; // $15 base — see estimateShippingRange
export const SHIPPING_ESTIMATE_HIGH_MINOR = 2500; // $25 base

/** Minimal product shape needed by every function below — a subset of MemberProductDTO. */
export type ShoppingProduct = {
  id: string;
  sku: string;
  name: string;
  editionLanguage: string;
  origin: string;
  condition: string;
  packsPerUnit: number;
  cardsPerPack: number | null;
  releaseStatus: string;
  description: string;
  priceMinor: number;
  currencyCode: string;
  availability: {
    checkedAt: string;
    confidence: string;
    statusLabel: string;
    stale: boolean;
    stockObserved: number | null;
  } | null;
  msrpMinor: number | null;
  marginMinor: number | null;
  marginBps: number | null;
  trending: boolean;
  trendingRank: number | null;
  requiresImportAcknowledgment: boolean;
};

/**
 * The sellable unit a buyer thinks in (boxes, cases, packs — not SKUs),
 * inferred from the product name. Used for the card's top line and
 * meta lines, never as a product-type claim stronger than the name.
 */
export function unitNoun(name: string): string {
  const n = name.toLowerCase();
  if (/\bcase\b/.test(n)) return "Case";
  if (/booster box/.test(n)) return "Booster Box";
  if (/elite trainer box|\betb\b/.test(n)) return "Elite Trainer Box";
  if (/\bbundle\b/.test(n)) return "Bundle";
  if (/\btin\b/.test(n)) return "Tin";
  if (/\bbooster pack\b/.test(n) || /\bpack\b/.test(n)) return "Booster Pack";
  return "Box";
}

/**
 * Unit-first card headline, e.g. "Booster Box — 36 packs". The price
 * anchor belongs to this unit; per-pack math lives in the meta line only.
 */
export function sellableUnitLabel(name: string, packsPerUnit: number): string {
  const noun = unitNoun(name);
  if (packsPerUnit > 1) return `${noun} — ${packsPerUnit} packs`;
  return noun;
}

/** Per-pack wholesale price in minor units, or null when unknowable (packsPerUnit <= 0). Meta-line use only. */
export function perPackPriceMinor(priceMinor: number, packsPerUnit: number): number | null {
  if (packsPerUnit <= 0) return null;
  return priceMinor / packsPerUnit; // fractional cents are fine — the meta line rounds on format
}

/** "In this box" spec block for the detail view: packs × cards, language, set identity, condition. */
export function unitSpecLines(p: Pick<ShoppingProduct, "packsPerUnit" | "cardsPerPack" | "editionLanguage" | "sku" | "condition" | "releaseStatus">): string[] {
  const lines: string[] = [];
  const packLine =
    p.cardsPerPack && p.cardsPerPack > 0 && p.packsPerUnit > 1
      ? `${p.packsPerUnit} packs × ${p.cardsPerPack} cards`
      : p.packsPerUnit > 1
        ? `${p.packsPerUnit} packs`
        : `${p.cardsPerPack ?? ""}${p.cardsPerPack ? " cards" : ""}`.trim();
  if (packLine) lines.push(packLine);
  lines.push(p.editionLanguage);
  lines.push(`Set code ${p.sku}`);
  lines.push(p.condition === "sealed" ? "Factory sealed" : "No shrink wrap");
  return lines;
}

export type AvailabilityChip = {
  label: string;
  kind: "ok" | "warn" | "bad" | "muted";
  /** Honest, non-scarcity tooltip/explainer. Never "almost gone". */
  detail: string;
};

/**
 * One honest availability chip per card. "Only N left" appears only when
 * the last source check genuinely observed a low count; zero stock shows
 * "Out of stock" (card stays visible with substitutes); preorder reads
 * from releaseStatus.
 */
export function availabilityChip(p: ShoppingProduct): AvailabilityChip {
  const a = p.availability;
  if (!a) {
    return {
      label: "Not yet checked",
      kind: "muted",
      detail: "We haven't verified stock with our source yet.",
    };
  }
  if (a.stale) {
    return {
      label: "Availability needs refresh",
      kind: "warn",
      detail: `Last checked ${checkedDateLabel(a.checkedAt)} — we'll re-verify before confirming your request.`,
    };
  }
  if (a.stockObserved !== null && a.stockObserved <= 0) {
    return {
      label: "Out of stock",
      kind: "bad",
      detail: "Not available right now. Substitutes are suggested below.",
    };
  }
  if (a.stockObserved !== null && a.stockObserved <= LOW_STOCK_THRESHOLD) {
    return {
      label: `Only ${a.stockObserved} left`,
      kind: "warn",
      detail: `Our last check saw ${a.stockObserved} unit${a.stockObserved === 1 ? "" : "s"} — nothing is reserved.`,
    };
  }
  if (/preorder/i.test(p.releaseStatus)) {
    return {
      label: "Preorder",
      kind: "ok",
      detail: "Available for preorder — expected ship date is shown before you submit.",
    };
  }
  return {
    label: "In stock",
    kind: "ok",
    detail: `In stock at our last check (${checkedDateLabel(a.checkedAt)}) — nothing is reserved.`,
  };
}

function checkedDateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown date" : d.toLocaleDateString("en-US");
}

export type MilestoneProgress = {
  minMet: boolean;
  feeApplies: boolean;
  feeMinor: number;
  toMinimumMinor: number;
  toFeeFreeMinor: number;
  /** 0–100, capped at the $750 fee-free milestone. */
  barPct: number;
  /** Marker position (0–100) for the $500 minimum on the same bar. */
  minMarkerPct: number;
  /** Plain-language goal framing: "You're $X away from …" — never a penalty frame. */
  message: string;
};

/** Dual-milestone progress: $500 submit unlocks · $750 drops the $25 small-order fee. */
export function milestoneProgress(subtotalMinor: number): MilestoneProgress {
  const minMet = subtotalMinor >= ORDER_MINIMUM_MINOR;
  const feeApplies = subtotalMinor < SMALL_ORDER_THRESHOLD_MINOR;
  const feeMinor = feeApplies ? SMALL_ORDER_FEE_MINOR : 0;
  const toMinimumMinor = Math.max(0, ORDER_MINIMUM_MINOR - subtotalMinor);
  const toFeeFreeMinor = Math.max(0, SMALL_ORDER_THRESHOLD_MINOR - subtotalMinor);
  const barPct = Math.min(100, (subtotalMinor / SMALL_ORDER_THRESHOLD_MINOR) * 100);
  const minMarkerPct = (ORDER_MINIMUM_MINOR / SMALL_ORDER_THRESHOLD_MINOR) * 100;

  let message: string;
  if (!minMet) {
    message =
      toFeeFreeMinor > 0
        ? `You're $${fmt(toMinimumMinor)} from the $500 minimum · $${fmt(toFeeFreeMinor)} from dropping the $25 fee`
        : `You're $${fmt(toMinimumMinor)} from the $500 minimum`;
  } else if (feeApplies) {
    message = `Minimum met — $${fmt(toFeeFreeMinor)} more drops the $25 small-order fee`;
  } else {
    message = "Minimum met and the small-order fee is dropped";
  }
  return { minMet, feeApplies, feeMinor, toMinimumMinor, toFeeFreeMinor, barPct, minMarkerPct, message };
}

function fmt(minor: number): string {
  return (minor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Search normalization: case-insensitive, punctuation-stripped ("yu-gi-oh" matches "Yu-Gi-Oh!"). */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Sharp faceted-lite search: every query token must appear somewhere in the product's searchable text. */
export function searchMatches(query: string, p: ShoppingProduct): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = normalizeSearch(
    [p.name, p.sku, p.editionLanguage, p.origin, p.releaseStatus, unitNoun(p.name)].join(" "),
  );
  return q.split(" ").every((token) => hay.includes(token));
}

/** Autocomplete suggestions: name + unit line for the top matches. */
export function searchSuggestions(
  query: string,
  products: ShoppingProduct[],
  limit = 6,
): { id: string; name: string; unitLine: string }[] {
  if (!normalizeSearch(query)) return [];
  const scored = products
    .filter((p) => searchMatches(query, p))
    .map((p) => {
      const name = normalizeSearch(p.name);
      const starts = normalizeSearch(query)
        .split(" ")
        .every((t) => name.startsWith(t) || name.split(" ").some((w) => w.startsWith(t)));
      return { p, score: starts ? 0 : 1 };
    })
    .sort((a, b) => a.score - b.score || (a.p.trendingRank ?? 99) - (b.p.trendingRank ?? 99));
  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    name: p.name,
    unitLine: `${sellableUnitLabel(p.name, p.packsPerUnit)} · $${(p.priceMinor / 100).toFixed(2)}`,
  }));
}

export type CuratedRows = {
  bestsellers: ShoppingProduct[];
  restocked: ShoppingProduct[];
  japaneseImports: ShoppingProduct[];
};

/**
 * Curated discovery for a small catalog (no dead-end filter grids).
 * - bestsellers: the real trailing-30-day trending set (lib/catalog/queries), ranked — never invented.
 * - restocked: checked fresh (within 7 days), non-stale, with observed stock — honest recency.
 * - japaneseImports: Japanese-language / Japan-origin product, whatever is actually listed.
 * Rows are capped; an empty row is simply not rendered by the caller.
 */
export function curatedRows(products: ShoppingProduct[], now: Date = new Date()): CuratedRows {
  const bestsellers = products
    .filter((p) => p.trending)
    .sort((a, b) => (a.trendingRank ?? 99) - (b.trendingRank ?? 99))
    .slice(0, CURATED_ROW_MAX);

  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const restocked = products
    .filter((p) => {
      const a = p.availability;
      if (!a || a.stale || (a.stockObserved !== null && a.stockObserved <= 0)) return false;
      const t = new Date(a.checkedAt).getTime();
      return !Number.isNaN(t) && t >= sevenDaysAgo;
    })
    .filter((p) => !p.trending)
    .slice(0, CURATED_ROW_MAX);

  const japaneseImports = products
    .filter((p) => /japan/i.test(p.editionLanguage) || /japan/i.test(p.origin))
    .slice(0, CURATED_ROW_MAX);

  return { bestsellers, restocked, japaneseImports };
}

export type ProductFilter = {
  type: "" | "Box" | "Case" | "Booster Pack" | "Bundle" | "Elite Trainer Box" | "Tin";
  language: string; // "" = any
  availability: "" | "in" | "low" | "preorder";
  priceBand: "" | "under100" | "100to250" | "over250";
  boughtBefore: boolean;
  inStockOnly: boolean;
};

export const EMPTY_FILTER: ProductFilter = {
  type: "",
  language: "",
  availability: "",
  priceBand: "",
  boughtBefore: false,
  inStockOnly: false,
};

/** Compact filter sheet logic (mobile drawer / desktop chips) — facets map to real fields only. */
export function applyFilter(
  products: ShoppingProduct[],
  f: ProductFilter,
  boughtBeforeIds: Set<string>,
): ShoppingProduct[] {
  return products.filter((p) => {
    if (f.type && unitNoun(p.name) !== f.type) return false;
    if (f.language && p.editionLanguage !== f.language) return false;
    if (f.boughtBefore && !boughtBeforeIds.has(p.id)) return false;
    const chip = availabilityChip(p);
    if (f.inStockOnly && chip.kind === "bad") return false;
    if (f.availability === "in" && chip.label !== "In stock") return false;
    if (f.availability === "low" && chip.label !== `Only ${p.availability?.stockObserved ?? -1} left`) return false;
    if (f.availability === "preorder" && chip.label !== "Preorder") return false;
    if (f.priceBand === "under100" && p.priceMinor >= 10000) return false;
    if (f.priceBand === "100to250" && (p.priceMinor < 10000 || p.priceMinor > 25000)) return false;
    if (f.priceBand === "over250" && p.priceMinor <= 25000) return false;
    return true;
  });
}

/** Language options present in the catalog, for the filter sheet. */
export function languageOptions(products: ShoppingProduct[]): string[] {
  return [...new Set(products.map((p) => p.editionLanguage))].sort();
}

/**
 * Out-of-stock substitutes: same sellable unit, genuinely in stock,
 * ranked by price proximity. Honest fallback, never a fake upsell.
 */
export function substituteSuggestions(p: ShoppingProduct, products: ShoppingProduct[], n = 3): ShoppingProduct[] {
  const noun = unitNoun(p.name);
  return products
    .filter((q) => q.id !== p.id && unitNoun(q.name) === noun && availabilityChip(q).label === "In stock")
    .sort((a, b) => Math.abs(a.priceMinor - p.priceMinor) - Math.abs(b.priceMinor - p.priceMinor))
    .slice(0, n);
}

/**
 * Estimated shipping range for the draft review screen. UI-planning
 * estimate only — freight is quoted at allocation, so this is labeled
 * "estimated" and never presented as a final charge. Scales gently with
 * the number of units.
 */
export function estimateShippingRange(units: number): { lowMinor: number; highMinor: number } {
  const n = Math.max(0, Math.floor(units));
  if (n === 0) return { lowMinor: 0, highMinor: 0 };
  const lowMinor = Math.max(1000, SHIPPING_ESTIMATE_LOW_MINOR + 100 * (n - 1) - 400);
  const highMinor = Math.max(lowMinor + 400, SHIPPING_ESTIMATE_HIGH_MINOR + 100 * (n - 1) + 400);
  return { lowMinor, highMinor };
}

export type DraftTotals = {
  units: number;
  subtotalMinor: number;
  feeMinor: number;
  shipLowMinor: number;
  shipHighMinor: number;
};

/** Draft totals from saved lines + a price lookup, reused by the sticky bar and the review screen. */
export function draftTotals(
  lines: { productId: string; qtyRequested: number }[],
  priceById: Map<string, { priceMinor: number }>,
): DraftTotals {
  let units = 0;
  let subtotalMinor = 0;
  for (const line of lines) {
    const price = priceById.get(line.productId);
    if (!price || !(line.qtyRequested > 0)) continue;
    units += line.qtyRequested;
    subtotalMinor += line.qtyRequested * price.priceMinor;
  }
  const { feeMinor } = milestoneProgress(subtotalMinor);
  const { lowMinor, highMinor } = estimateShippingRange(units);
  return { units, subtotalMinor, feeMinor, shipLowMinor: lowMinor, shipHighMinor: highMinor };
}

export type CsvLineResult = { sku: string; qty: number; productId: string };
export type CsvLineError = { line: number; raw: string; reason: string };

/**
 * Quick-order CSV/paste parser: "SKU, qty" per line (comma, tab, or
 * semicolon separated). Resolves against the catalog with per-line error
 * flags — never silently drops a line.
 */
export function parseQuickOrderLines(
  text: string,
  products: Pick<ShoppingProduct, "id" | "sku">[],
): { ok: CsvLineResult[]; errors: CsvLineError[] } {
  const bySku = new Map(products.map((p) => [normalizeSearch(p.sku), p]));
  const ok: CsvLineResult[] = [];
  const errors: CsvLineError[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const lineNo = idx + 1;
    const parts = raw.split(/[,\t;]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      errors.push({ line: lineNo, raw, reason: "Need two columns: SKU, qty." });
      return;
    }
    const [skuRaw, qtyRaw] = parts;
    const product = bySku.get(normalizeSearch(skuRaw!));
    if (!product) {
      errors.push({ line: lineNo, raw, reason: `SKU "${skuRaw}" isn't in the catalog.` });
      return;
    }
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) {
      errors.push({ line: lineNo, raw, reason: `Qty "${qtyRaw}" must be a whole number of units.` });
      return;
    }
    if (seen.has(product.id)) {
      errors.push({ line: lineNo, raw, reason: `SKU "${skuRaw}" appears twice — keep one line.` });
      return;
    }
    seen.add(product.id);
    ok.push({ sku: skuRaw!, qty, productId: product.id });
  });
  return { ok, errors };
}

/**
 * "Resume your draft" naming for the catalog banner: top lines by qty,
 * e.g. "3× Prismatic Evolutions Booster Box, 2× Stellar Crystal Box".
 */
export function draftSummaryNames(
  lines: { productId: string; qtyRequested: number }[],
  nameById: Map<string, string>,
  max = 3,
): string {
  const named = lines
    .filter((l) => l.qtyRequested > 0 && nameById.has(l.productId))
    .sort((a, b) => b.qtyRequested - a.qtyRequested)
    .slice(0, max)
    .map((l) => `${l.qtyRequested}× ${nameById.get(l.productId)}`);
  const rest = lines.filter((l) => l.qtyRequested > 0).length - named.length;
  return rest > 0 ? `${named.join(", ")} +${rest} more` : named.join(", ");
}

/**
 * Named lines for the abandoned-draft reminder email ("3× Prismatic
 * Evolutions Booster Box…") — naming contents beats generic copy.
 */
export function reminderNamedLines(
  lines: { productId: string; qtyRequested: number }[],
  nameById: Map<string, string>,
  max = 4,
): { name: string; qty: number }[] {
  return lines
    .filter((l) => l.qtyRequested > 0 && nameById.has(l.productId))
    .sort((a, b) => b.qtyRequested - a.qtyRequested)
    .slice(0, max)
    .map((l) => ({ name: nameById.get(l.productId)!, qty: l.qtyRequested }));
}
