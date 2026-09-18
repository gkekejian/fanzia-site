import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, accountContact, orderRequest } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Viewing an order request");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, params.id)).limit(1);
  if (!row) return NextResponse.json({ error: "Order request not found." }, { status: 404 });

  const [acct] = await db.select().from(account).where(eq(account.id, row.accountId)).limit(1);
  const [contact] = await db.select().from(accountContact).where(eq(accountContact.id, row.contactId)).limit(1);

  return NextResponse.json({
    orderRequest: row,
    account: acct
      ? {
          id: acct.id,
          legalName: acct.legalName,
          taxStatus: acct.taxStatus,
          city: acct.city,
          state: acct.state,
          primaryContactEmail: acct.primaryContactEmail,
        }
      : null,
    contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : null,
  });
}
