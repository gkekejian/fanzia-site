import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { processOfferDeadlines } from "@/lib/offers/lifecycle";

/**
 * Expire allocation offers past their deadline and re-offer the units.
 * Bearer CRON_SECRET, same as the other crons. Safe to call as often as
 * you like: every transition is conditional, so overlapping runs are
 * harmless. Vercel Hobby only runs crons daily, so offers are also
 * processed whenever a buyer or owner opens an offers page or Today; the
 * optional GitHub Action (.github/workflows/offer-deadlines.yml) pings
 * this every 30 minutes for tighter deadlines.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processOfferDeadlines(db, {});
  return NextResponse.json({ ok: true, ...result });
}
