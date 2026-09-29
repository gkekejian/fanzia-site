import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { declineOffer } from "@/lib/offers/lifecycle";
import { OfferError } from "@/lib/offers/context";

/** Decline: the units go to the next buyer in line right away. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  const json = await req.json().catch(() => null);
  try {
    await declineOffer(db, buyer, params.id, { reason: typeof json?.reason === "string" ? json.reason : null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
