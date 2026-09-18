import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { performOrPropose } from "@/lib/auth/rbac";
import {
  markPricingReal,
  NotFoundError,
  setMarketPrice,
  ValidationError,
} from "@/lib/priceIntel/service";

/**
 * Manual market-price entry. sourceUrl is REQUIRED — every market price
 * must point at the page it was observed on (auditability). Body:
 * { productId, marketPriceMinor, sourceUrl, notes? } where
 * marketPriceMinor is the per-unit price in USD cents.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const body = await req.json().catch(() => null);
  const productId = String(body?.productId ?? "");
  const marketPriceMinor = Number(body?.marketPriceMinor);
  const sourceUrl = String(body?.sourceUrl ?? "");
  const notes = typeof body?.notes === "string" ? body.notes : undefined;
  if (!productId || !Number.isFinite(marketPriceMinor) || !sourceUrl) {
    return NextResponse.json(
      { error: "productId, marketPriceMinor (USD cents), and sourceUrl are required." },
      { status: 400 },
    );
  }

  try {
    const payload = { kind: "market_price", productId, marketPriceMinor, sourceUrl, notes };
    const result = await performOrPropose(
      actor,
      "price_intel.price_update",
      { type: "market_price", id: productId },
      payload,
      () => setMarketPrice({ actor, productId, marketPriceMinor, sourceUrl, notes }),
    );
    if (!result.executed) {
      return NextResponse.json(
        { queued: true, proposalId: result.proposalId },
        { status: 202 },
      );
    }
    return NextResponse.json({ applied: true, id: result.result.id });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

/**
 * Explicit estimated→real flip (PUT .../market?action=mark-real or POST
 * with kind). Kept on the same route group as market pricing because the
 * flip means "the owner has verified this product's price stack."
 * Body: { productId, notes? } — explicit owner action, audit-logged with
 * old/new; nothing auto-flips in v1.
 */
export async function PUT(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const body = await req.json().catch(() => null);
  const productId = String(body?.productId ?? "");
  const notes = typeof body?.notes === "string" ? body.notes : undefined;
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  try {
    const payload = { kind: "mark_real", productId, notes };
    const result = await performOrPropose(
      actor,
      "price_intel.price_update",
      { type: "product_pricing_flag", id: productId },
      payload,
      () => markPricingReal({ actor, productId, notes }),
    );
    if (!result.executed) {
      return NextResponse.json(
        { queued: true, proposalId: result.proposalId },
        { status: 202 },
      );
    }
    return NextResponse.json({ applied: true, isReal: "real" });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
