import { NextRequest, NextResponse } from "next/server";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { getMemberCatalog } from "@/lib/catalog/queries";

/** Price and availability only ever reach this response after requireBuyer resolves a real, unexpired buyer session (test gate #1). */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const products = await getMemberCatalog();
  return NextResponse.json({ products });
}
