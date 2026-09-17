import { NextRequest, NextResponse } from "next/server";
import { getBuyerSessionContact, BUYER_SESSION_COOKIE, type AuthedBuyer } from "./buyerSession";

/**
 * Every member-catalog and draft-request API route resolves its buyer
 * through here — the single chokepoint that decides whether a request is
 * "authenticated buyer" or "everyone else" (test gate #1). There is no
 * other code path in app/api/member/** that reads pricing or availability
 * without going through this first.
 */
export async function requireBuyer(req: NextRequest): Promise<AuthedBuyer | NextResponse> {
  const raw = req.cookies.get(BUYER_SESSION_COOKIE)?.value;
  const buyer = await getBuyerSessionContact(raw);
  if (!buyer) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return buyer;
}
