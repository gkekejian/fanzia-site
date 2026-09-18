import { NextRequest, NextResponse } from "next/server";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { getPurchasedProductIds } from "@/lib/catalog/queries";

/**
 * Product ids this buyer account has previously purchased, for the
 * catalog's "Bought before" filter. Account-scoped by requireBuyer —
 * one account's history never leaks to another.
 */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const productIds = await getPurchasedProductIds(buyer.accountId);
  return NextResponse.json({ productIds });
}
