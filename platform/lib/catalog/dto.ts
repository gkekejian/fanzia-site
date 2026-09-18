import type { product, sourcingRoute } from "@/db/schema";
import type { priceEpoch } from "@/db/schema";
import { CONFIDENCE_LABEL, isExpired } from "./staleness";

type ProductRow = typeof product.$inferSelect;
type PriceEpochRow = typeof priceEpoch.$inferSelect;
type SourcingRouteRow = typeof sourcingRoute.$inferSelect;

/**
 * Every field here is the field-for-field allowlist build prompt §18 says
 * the public catalog may show — product identity and specifications only.
 * This is the boundary for test gate #1: this type has no price,
 * availability, supplier, or cost field to leak, by construction — a
 * caller cannot accidentally serialize a forbidden field because it was
 * never assigned onto this object in the first place.
 */
export type PublicProductDTO = {
  sku: string;
  name: string;
  editionLanguage: string;
  origin: string;
  condition: string;
  packsPerUnit: number;
  cardsPerPack: number | null;
  releaseStatus: string;
  description: string;
};

export function toPublicProductDTO(p: ProductRow): PublicProductDTO {
  return {
    sku: p.sku,
    name: p.name,
    editionLanguage: p.editionLanguage,
    origin: p.origin,
    condition: p.condition,
    packsPerUnit: p.packsPerUnit,
    cardsPerPack: p.cardsPerPack,
    releaseStatus: p.releaseStatus,
    description: p.descriptionOriginal,
  };
}

export type MemberAvailability = {
  checkedAt: string;
  confidence: string;
  statusLabel: string;
  stale: boolean;
};

/**
 * Adds price and availability — the fields build prompt §18 says are
 * member-only and must never reach an unauthenticated response. Never
 * includes supplier identity, route, cost, markup, or margin — those stay
 * server-only regardless of buyer auth (build prompt §9/§10); see
 * toAdminProductDTO for the owner/ai_operator-only superset.
 */
export type MemberProductDTO = PublicProductDTO & {
  id: string;
  priceMinor: number;
  currencyCode: string;
  availability: MemberAvailability | null;
  /**
   * Terms-relevant flag: this product is sourced through an import route, so
   * the buyer must acknowledge the import notice before ordering. Not
   * cost, margin, supplier, or route data — those stay server-only.
   */
  requiresImportAcknowledgment: boolean;
};

export function toMemberProductDTO(
  p: ProductRow,
  price: Pick<PriceEpochRow, "priceMinor" | "currencyCode">,
  latestCheck: { checkedAt: Date; confidence: string; validUntil: Date } | null,
  requiresImportAcknowledgment: boolean = false,
): MemberProductDTO {
  return {
    ...toPublicProductDTO(p),
    id: p.id, // needed to reference the product in a draft_request line (lib/catalog/draftRequest.ts); not sensitive on its own
    priceMinor: price.priceMinor,
    currencyCode: price.currencyCode,
    availability: latestCheck
      ? {
          checkedAt: latestCheck.checkedAt.toISOString(),
          confidence: latestCheck.confidence,
          statusLabel: `${CONFIDENCE_LABEL[latestCheck.confidence] ?? "Checked with our source"} on ${latestCheck.checkedAt.toLocaleDateString("en-US")}.`,
          stale: isExpired(latestCheck.validUntil),
        }
      : null,
    requiresImportAcknowledgment,
  };
}

export type CostStack = {
  supplierId: string;
  supplierName: string;
  costMinor: number;
  markupBps: number;
  markupFloorBps: number;
  realizedGrossMarginBps: number;
  routeType: string;
  routeConfidence: string;
  belowMarkupFloor: boolean;
};

export type AdminProductDTO = MemberProductDTO & {
  status: string;
  publiclyVisible: boolean;
  costStack?: CostStack;
};

/**
 * `canSeeCostStack` must come from lib/auth/rbac.ts's `canSeeCostStack(actor)`
 * — true for every owner, and for an ai_operator only when its API key has
 * the explicit `cost_stack:read` scope (build prompt §14: "masked at the
 * API layer for any agent scope lacking explicit cost_stack:read", test
 * gate #33). When false, the cost stack is omitted entirely rather than
 * nulled out, so it can never round-trip through JSON as a visible key.
 */
export function toAdminProductDTO(
  canSeeCostStack: boolean,
  p: ProductRow,
  price: PriceEpochRow | null,
  route: SourcingRouteRow | null,
  supplierName: string | null,
  markupFloorBps: number,
  latestCheck: { checkedAt: Date; confidence: string; validUntil: Date } | null,
): AdminProductDTO {
  const base: AdminProductDTO = price
    ? { ...toMemberProductDTO(p, price, latestCheck, route?.routeType === "import"), status: p.status, publiclyVisible: p.publiclyVisible }
    : { ...toPublicProductDTO(p), id: p.id, priceMinor: 0, currencyCode: "", availability: null, requiresImportAcknowledgment: false, status: p.status, publiclyVisible: p.publiclyVisible };

  if (!canSeeCostStack || !price || !route) return base;

  const floorBps = route.markupFloorBpsOverride ?? markupFloorBps;
  return {
    ...base,
    costStack: {
      supplierId: route.supplierId,
      supplierName: supplierName ?? "(unknown)",
      costMinor: price.costMinor,
      markupBps: price.markupBps,
      markupFloorBps: floorBps,
      realizedGrossMarginBps: price.realizedGrossMarginBps,
      routeType: route.routeType,
      routeConfidence: route.confidence,
      belowMarkupFloor: price.markupBps < floorBps,
    },
  };
}
