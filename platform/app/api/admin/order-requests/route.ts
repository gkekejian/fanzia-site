import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, orderRequest } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

const VALID_STATUSES = ["submitted", "approved", "declined", "expired", "invoiced", "cancelled", "superseded"];

export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing order requests");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const rows = await db
    .select({
      id: orderRequest.id,
      accountId: orderRequest.accountId,
      accountName: account.legalName,
      subtotalMinor: orderRequest.subtotalMinor,
      smallOrderFeeMinor: orderRequest.smallOrderFeeMinor,
      status: orderRequest.status,
      expiresAt: orderRequest.expiresAt,
      rolloverCount: orderRequest.rolloverCount,
      createdAt: orderRequest.createdAt,
    })
    .from(orderRequest)
    .innerJoin(account, eq(orderRequest.accountId, account.id))
    .where(status && VALID_STATUSES.includes(status) ? eq(orderRequest.status, status) : undefined)
    .orderBy(desc(orderRequest.createdAt))
    .limit(200);

  return NextResponse.json({ orderRequests: rows });
}
