import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { runOfferDeadlines } from "@/lib/offers/drops";

/**
 * Expire allocation offers past their deadline, re-offer freed units, and
 * close drops whose deadline has passed (creating their supplier round).
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
  const result = await runOfferDeadlines(db);
  return NextResponse.json({ ok: true, ...result });
}
