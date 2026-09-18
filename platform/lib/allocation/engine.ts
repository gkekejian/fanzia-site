/**
 * Pure allocation engine (fanzia-as-client design doc §2.3 — FAIRNESS:
 * FANZIA-FIRST, decided 2026-09-18).
 *
 * Per product:
 *  1. The internal account's requested qty is filled first, capped at
 *     available units.
 *  2. The remainder is split across external accounts pro-rata:
 *     floor(requested × remainder / totalExternalRequested), with leftover
 *     units distributed one at a time to the largest fractional remainders
 *     (deterministic tiebreak on lineId).
 *  3. Each participant's allocation is then snapped DOWN to a case-size
 *     multiple. Units freed by snapping are returned as whole cases to the
 *     participants with the largest fractional remainder (deterministic
 *     tiebreak on lineId), so the total never exceeds available.
 *
 * This function performs no I/O: it takes request lines and distributor
 * availability and returns per-line allocations plus per-product
 * summaries. Stored by the allocate API endpoint; the owner reviews and
 * approves (adjustments logged with reason) before the round closes.
 */

/** Immutable fairness policy snapshot stored on every allocation round. */
export const ALLOCATION_POLICY_SNAPSHOT = {
  mode: "fanzia_first",
  external_split: "pro_rata_largest_remainder",
} as const;

export type AllocationPolicyMode = typeof ALLOCATION_POLICY_SNAPSHOT.mode;

/**
 * Fixed policy dropdown — the owner chooses from this list at round
 * creation, never free text. Only fanzia_first is implemented; adding a
 * policy means adding an engine path here plus an owner action + audit
 * entry changing the default.
 */
export const ALLOCATION_POLICY_OPTIONS = [
  {
    mode: "fanzia_first" as const,
    label: "Fanzia internal filled first, remainder split pro-rata across external buyers",
  },
] as const;

export interface AllocationInputLine {
  lineId: string;
  productId: string;
  accountId: string;
  requestedQty: number;
}

export interface AllocateRoundInput {
  lines: AllocationInputLine[];
  /** Units the distributor has available per product. Missing/≤0 = none. */
  availableByProduct: Record<string, number>;
  /** Units per case per product for post-allocation snapping. ≤1/absent = no snap. */
  caseSizes: Record<string, number>;
  /** The internal Fanzia buyer account; NULL = no internal participant. */
  internalAccountId: string | null;
}

export interface AllocationResultLine {
  lineId: string;
  productId: string;
  accountId: string;
  requestedQty: number;
  allocatedQty: number;
}

export interface AllocationProductSummary {
  requested: number;
  allocated: number;
  /** Accounts shorted vs their request, in units (only positive shortfalls). */
  shortfallByAccount: Record<string, number>;
}

export interface AllocateRoundResult {
  lines: AllocationResultLine[];
  summaryByProduct: Record<string, AllocationProductSummary>;
}

/** Float guard: 2.9999999999 caused by requested × remainder / total. */
const EPS = 1e-9;

function clampUnits(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Distribute `total` whole units across items by exact fractional `share`,
 * largest-remainder. Deterministic: ties break on ascending key. Returns a
 * per-key allocation summing to exactly `total`.
 */
function splitLargestRemainder(items: { key: string; share: number }[], total: number): Record<string, number> {
  const allocated: Record<string, number> = {};
  const fractions: { key: string; frac: number }[] = [];
  let assigned = 0;
  for (const item of items) {
    const base = Math.floor(item.share + EPS);
    allocated[item.key] = base;
    assigned += base;
    fractions.push({ key: item.key, frac: item.share + EPS - base });
  }
  let leftover = total - assigned;
  fractions.sort((a, b) => (b.frac - a.frac !== 0 ? b.frac - a.frac : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let i = 0;
  while (leftover > 0 && fractions.length > 0) {
    const entry = fractions[i % fractions.length];
    if (!entry) break;
    allocated[entry.key] = (allocated[entry.key] ?? 0) + 1;
    leftover -= 1;
    i += 1;
  }
  return allocated;
}

function allocateProduct(
  lines: { lineId: string; accountId: string; requestedQty: number }[],
  available: number,
  caseSize: number,
  internalAccountId: string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.lineId] = 0;
  if (available <= 0 || lines.length === 0) return out;

  const internal = lines.filter((l) => internalAccountId !== null && l.accountId === internalAccountId);
  const external = lines.filter((l) => !(internalAccountId !== null && l.accountId === internalAccountId));

  // 1. Internal first, capped at available.
  let remaining = available;
  const internalRequested = internal.reduce((s, l) => s + l.requestedQty, 0);
  if (internal.length > 0 && internalRequested > 0 && remaining > 0) {
    const fill = Math.min(internalRequested, remaining);
    const shares = internal.map((l) => ({
      key: l.lineId,
      share: (l.requestedQty * fill) / internalRequested,
    }));
    const split = splitLargestRemainder(shares, fill);
    for (const l of internal) out[l.lineId] = split[l.lineId] ?? 0;
    remaining -= fill;
  }

  // 2. Externals split the remainder pro-rata, largest-remainder. The split
  //    target is capped at total external requested so no line can ever be
  //    allocated more than it asked for (remainder > requested happens when
  //    distributor stock covers every request).
  const externalRequested = external.reduce((s, l) => s + l.requestedQty, 0);
  if (external.length > 0 && externalRequested > 0 && remaining > 0) {
    const target = Math.min(externalRequested, remaining);
    const shares = external.map((l) => ({
      key: l.lineId,
      share: (l.requestedQty * target) / externalRequested,
    }));
    const split = splitLargestRemainder(shares, target);
    for (const l of external) out[l.lineId] = split[l.lineId] ?? 0;
  }

  // 3. Snap DOWN to case-size multiples; return freed units as whole cases
  //    to the largest fractional remainders (deterministic).
  const snap = Math.floor(caseSize);
  if (snap > 1) {
    const fractions: { key: string; frac: number }[] = [];
    let freed = 0;
    for (const l of lines) {
      const q = out[l.lineId] ?? 0;
      const base = Math.floor(q / snap) * snap;
      out[l.lineId] = base;
      freed += q - base;
      fractions.push({ key: l.lineId, frac: q / snap - Math.floor(q / snap + EPS) + EPS });
    }
    fractions.sort((a, b) => (b.frac - a.frac !== 0 ? b.frac - a.frac : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let pool = freed;
    for (const f of fractions) {
      if (pool < snap) break;
      out[f.key] = (out[f.key] ?? 0) + snap;
      pool -= snap;
    }
  }

  return out;
}

export function allocateRound(input: AllocateRoundInput): AllocateRoundResult {
  const cleanLines = input.lines.map((l) => ({
    lineId: l.lineId,
    productId: l.productId,
    accountId: l.accountId,
    requestedQty: clampUnits(l.requestedQty),
  }));

  const byProduct = new Map<string, typeof cleanLines>();
  for (const l of cleanLines) {
    const bucket = byProduct.get(l.productId) ?? [];
    bucket.push(l);
    byProduct.set(l.productId, bucket);
  }

  const resultLines: AllocationResultLine[] = [];
  const summaryByProduct: Record<string, AllocationProductSummary> = {};

  for (const [productId, productLines] of byProduct) {
    const available = clampUnits(input.availableByProduct[productId] ?? 0);
    const caseSize = Math.floor(input.caseSizes[productId] ?? 1);
    const allocatedByLine = allocateProduct(productLines, available, caseSize, input.internalAccountId);

    const requestedByAccount: Record<string, number> = {};
    const allocatedByAccount: Record<string, number> = {};
    let requested = 0;
    let allocated = 0;
    for (const l of productLines) {
      const q = allocatedByLine[l.lineId] ?? 0;
      resultLines.push({
        lineId: l.lineId,
        productId: l.productId,
        accountId: l.accountId,
        requestedQty: l.requestedQty,
        allocatedQty: q,
      });
      requested += l.requestedQty;
      allocated += q;
      requestedByAccount[l.accountId] = (requestedByAccount[l.accountId] ?? 0) + l.requestedQty;
      allocatedByAccount[l.accountId] = (allocatedByAccount[l.accountId] ?? 0) + q;
    }

    const shortfallByAccount: Record<string, number> = {};
    for (const accountId of Object.keys(requestedByAccount)) {
      const shortfall = (requestedByAccount[accountId] ?? 0) - (allocatedByAccount[accountId] ?? 0);
      if (shortfall > 0) shortfallByAccount[accountId] = shortfall;
    }
    summaryByProduct[productId] = { requested, allocated, shortfallByAccount };
  }

  return { lines: resultLines, summaryByProduct };
}

/** Plain-words rendering of the policy for the review screen header. */
export function describeAllocationPolicy(): string {
  return "Fanzia internal filled first, remainder split pro-rata across external buyers";
}
