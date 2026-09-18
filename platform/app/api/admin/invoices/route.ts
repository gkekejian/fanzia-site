import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, invoice } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

const VALID_STATUSES = ["draft", "sent", "paid", "partial", "void"];

export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing invoices");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const rows = await db
    .select({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      accountId: invoice.accountId,
      accountName: account.legalName,
      totalMinor: invoice.totalMinor,
      status: invoice.status,
      sentAt: invoice.sentAt,
      createdAt: invoice.createdAt,
    })
    .from(invoice)
    .innerJoin(account, eq(invoice.accountId, account.id))
    .where(status && VALID_STATUSES.includes(status) ? eq(invoice.status, status) : undefined)
    .orderBy(desc(invoice.createdAt))
    .limit(200);

  return NextResponse.json({ invoices: rows });
}
