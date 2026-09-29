import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { canOrder } from "@/lib/users/contactRoles";
import { getInterest, interestInputSchema, saveInterest } from "@/lib/offers/interest";
import { OfferError } from "@/lib/offers/context";

/** The buyer's interest list. Same shape as the draft API so the catalog stepper works on either. */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  return NextResponse.json({ draft: { lines: await getInterest(db, buyer.accountId), notes: null } });
}

export async function PUT(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  if (!canOrder(buyer.contactRole)) {
    return NextResponse.json({ error: "Your account role is view-only. Ask your account's primary contact." }, { status: 403 });
  }
  const parsed = interestInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  try {
    const lines = await saveInterest(db, buyer.accountId, parsed.data);
    return NextResponse.json({ ok: true, draft: { lines, notes: null } });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
