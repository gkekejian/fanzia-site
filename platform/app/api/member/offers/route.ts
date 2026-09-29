import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { listBuyerOffers } from "@/lib/offers/lifecycle";
import { getSavedCard } from "@/lib/offers/cards";
import { runOfferDeadlines } from "@/lib/offers/drops";

/** The buyer's own offers (live first) plus their saved card for the Accept & pay label. */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  // Hobby plan: page visits keep deadlines moving between daily crons.
  await runOfferDeadlines(db).catch((err) => console.error("[offers] deadline sweep failed", err));
  const [offers, card] = await Promise.all([listBuyerOffers(db, buyer.accountId), getSavedCard(db, buyer.accountId)]);
  return NextResponse.json({ offers, card });
}
