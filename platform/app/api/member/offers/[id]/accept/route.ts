import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { acceptOffer } from "@/lib/offers/lifecycle";
import { OfferError } from "@/lib/offers/context";
import { clientIp, rateLimited, PUBLIC_WRITE_LIMITS } from "@/lib/rateLimit";

/** Accept & pay: charges the saved card, or returns a Checkout URL to finish paying. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  const limited = await rateLimited(`offer-accept:${buyer.accountId}:${clientIp(req.headers)}`, PUBLIC_WRITE_LIMITS.draftRequestSubmit);
  if (limited) return limited;
  const json = await req.json().catch(() => null);
  try {
    const result = await acceptOffer(db, buyer, params.id, { importAcknowledged: json?.importAcknowledged === true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
