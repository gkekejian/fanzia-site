import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, invoice, refundDue } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/** Owner-only list of refunds owed / paid (newest first). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Viewing refunds");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: refundDue.id,
      amountMinor: refundDue.amountMinor,
      status: refundDue.status,
      method: refundDue.method,
      reason: refundDue.reason,
      lastError: refundDue.lastError,
      createdAt: refundDue.createdAt,
      invoiceId: refundDue.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      accountName: account.legalName,
    })
    .from(refundDue)
    .innerJoin(invoice, eq(invoice.id, refundDue.invoiceId))
    .innerJoin(account, eq(account.id, refundDue.accountId))
    .orderBy(desc(refundDue.createdAt))
    .limit(200);
  return NextResponse.json({ refunds: rows });
}
