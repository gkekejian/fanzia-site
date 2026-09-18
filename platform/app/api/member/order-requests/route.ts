import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orderRequest } from "@/db/schema";
import { requireBuyer } from "@/lib/auth/buyerActor";

/**
 * The buyer's own order-request history: submitted, approved, declined,
 * expired, invoiced. Only the authed buyer's account — never another's.
 * Lines carry the buyer's own snapshotted prices only (no supplier
 * identity, terms, costs, or markup anywhere in this DTO).
 */
export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const rows = await db
    .select({
      id: orderRequest.id,
      lines: orderRequest.lines,
      notes: orderRequest.notes,
      subtotalMinor: orderRequest.subtotalMinor,
      smallOrderFeeMinor: orderRequest.smallOrderFeeMinor,
      status: orderRequest.status,
      expiresAt: orderRequest.expiresAt,
      decidedAt: orderRequest.decidedAt,
      declineReason: orderRequest.declineReason,
      createdAt: orderRequest.createdAt,
    })
    .from(orderRequest)
    .where(eq(orderRequest.accountId, buyer.accountId))
    .orderBy(desc(orderRequest.createdAt))
    .limit(200);

  return NextResponse.json({ orderRequests: rows });
}
