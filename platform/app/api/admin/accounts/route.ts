import { NextRequest, NextResponse } from "next/server";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { account, accountContact } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/**
 * Buyer account directory — owner-only. This is the customer master list
 * the dashboard never had: approving an application creates one of these,
 * but until now no UI or API could even list them.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing buyer accounts");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const where = q
    ? or(ilike(account.legalName, `%${q}%`), ilike(account.primaryContactEmail, `%${q}%`))
    : undefined;

  const rows = await db
    .select({
      id: account.id,
      legalName: account.legalName,
      channelType: account.channelType,
      taxStatus: account.taxStatus,
      city: account.city,
      state: account.state,
      primaryContactName: account.primaryContactName,
      primaryContactEmail: account.primaryContactEmail,
      contactCount: sql<number>`count(${accountContact.id})`.as("contact_count"),
      createdAt: account.createdAt,
    })
    .from(account)
    .leftJoin(accountContact, eq(accountContact.accountId, account.id))
    .where(where)
    .groupBy(account.id)
    .orderBy(desc(account.createdAt))
    .limit(100);

  return NextResponse.json({ accounts: rows });
}
