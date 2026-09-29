import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { canOrder } from "@/lib/users/contactRoles";
import { getSavedCard, removeSavedCard, startCardSetup } from "@/lib/offers/cards";
import { OfferError } from "@/lib/offers/context";

export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  return NextResponse.json({ card: await getSavedCard(db, buyer.accountId), canManage: canOrder(buyer.contactRole) });
}

/** Start Stripe Checkout (setup mode) to add or replace the card. */
export async function POST(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  if (!canOrder(buyer.contactRole)) {
    return NextResponse.json({ error: "Only contacts who can buy may change the card on file." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await startCardSetup(db, buyer.accountId)) });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  if (!canOrder(buyer.contactRole)) {
    return NextResponse.json({ error: "Only contacts who can buy may change the card on file." }, { status: 403 });
  }
  await removeSavedCard(db, buyer.accountId, buyer.contactEmail);
  return NextResponse.json({ ok: true });
}
