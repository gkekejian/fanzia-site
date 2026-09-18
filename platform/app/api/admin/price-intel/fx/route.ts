import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { performOrPropose } from "@/lib/auth/rbac";
import { setFxRate, ValidationError } from "@/lib/priceIntel/service";

/**
 * Manual FX rate entry (owner-only semantics: the agent path goes through
 * the proposal queue). FX rates are append-only — setting a new rate is a
 * new row, never an edit — so the rate assumed at any point in time stays
 * in history. Body: { fromCurrency, toCurrency, rate } e.g.
 * { "fromCurrency": "JPY", "toCurrency": "USD", "rate": 0.0066 }.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const body = await req.json().catch(() => null);
  const fromCurrency = String(body?.fromCurrency ?? "").toUpperCase();
  const toCurrency = String(body?.toCurrency ?? "").toUpperCase();
  const rate = Number(body?.rate);
  if (!fromCurrency || !toCurrency || !Number.isFinite(rate)) {
    return NextResponse.json(
      { error: "fromCurrency, toCurrency, and a numeric rate are required." },
      { status: 400 },
    );
  }

  try {
    const payload = { kind: "fx_rate", fromCurrency, toCurrency, rate };
    const result = await performOrPropose(
      actor,
      "price_intel.price_update",
      { type: "fx_rate" },
      payload,
      () => setFxRate({ actor, fromCurrency, toCurrency, rate }),
    );
    if (!result.executed) {
      return NextResponse.json(
        { queued: true, proposalId: result.proposalId },
        { status: 202 },
      );
    }
    return NextResponse.json({ applied: true, id: result.result.id });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
