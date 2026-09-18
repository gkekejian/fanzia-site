import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { account, accountContact, taxDetermination, buyerSession } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Viewing a buyer account");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db.select().from(account).where(eq(account.id, params.id)).limit(1);
  const acct = rows[0];
  if (!acct) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const contacts = await db
    .select({
      id: accountContact.id,
      name: accountContact.name,
      email: accountContact.email,
      roleOnAccount: accountContact.roleOnAccount,
      active: accountContact.active,
      createdAt: accountContact.createdAt,
    })
    .from(accountContact)
    .where(eq(accountContact.accountId, acct.id))
    .orderBy(desc(accountContact.createdAt));

  const determinations = await db
    .select({
      id: taxDetermination.id,
      status: taxDetermination.status,
      notes: taxDetermination.notes,
      determinedAt: taxDetermination.determinedAt,
    })
    .from(taxDetermination)
    .where(eq(taxDetermination.accountId, acct.id))
    .orderBy(desc(taxDetermination.determinedAt))
    .limit(5);

  const liveSessions = await db
    .select({ id: buyerSession.id })
    .from(buyerSession)
    .where(eq(buyerSession.accountId, acct.id));

  return NextResponse.json({
    account: acct,
    contacts,
    taxDeterminations: determinations,
    liveSessionCount: liveSessions.length,
  });
}
