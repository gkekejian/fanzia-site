import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { listBuyerOffers } from "@/lib/offers/lifecycle";
import { getSavedCard } from "@/lib/offers/cards";

/** The buyer's own offers (live first) plus their saved card for the Accept & pay label. */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  const [offers, card] = await Promise.all([listBuyerOffers(db, buyer.accountId), getSavedCard(db, buyer.accountId)]);
  return NextResponse.json({ offers, card });
}
