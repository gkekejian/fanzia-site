import type { PgDatabase } from "drizzle-orm/pg-core";
import { cookies } from "next/headers";
import { eq, isNull, gt, and } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { buyerSession as buyerSessionTable, accountContact as accountContactTable, account as accountTable } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const BUYER_SESSION_COOKIE = "fz_buyer_session";
const BUYER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — a wholesale buyer, not a one-off checkout

export type AuthedBuyer = {
  accountContactId: string;
  accountId: string;
  contactName: string;
  contactEmail: string;
};

/**
 * Deliberately its own cookie name and table, independent of the owner
 * `session` table (lib/auth/session.ts) — a buyer session must never be
 * able to read or interfere with an admin session or vice versa, same
 * independence guarantee build prompt §14.1 requires between owner and
 * ai_operator sessions.
 */
export async function createBuyerSession(
  accountContactId: string,
  accountId: string,
  meta: { ip?: string | null; userAgent?: string | null },
  db: AnyDb = defaultDb,
) {
  const raw = generateToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + BUYER_SESSION_TTL_MS);
  await db.insert(buyerSessionTable).values({
    accountContactId,
    accountId,
    tokenHash,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    expiresAt,
  });
  return { raw, expiresAt };
}

export async function getBuyerSessionContact(
  rawToken: string | undefined,
  db: AnyDb = defaultDb,
): Promise<AuthedBuyer | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select({ contact: accountContactTable, session: buyerSessionTable, account: accountTable })
    .from(buyerSessionTable)
    .innerJoin(accountContactTable, eq(buyerSessionTable.accountContactId, accountContactTable.id))
    .innerJoin(accountTable, eq(buyerSessionTable.accountId, accountTable.id))
    .where(
      and(
        eq(buyerSessionTable.tokenHash, tokenHash),
        isNull(buyerSessionTable.revokedAt),
        gt(buyerSessionTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    accountContactId: row.contact.id,
    accountId: row.account.id,
    contactName: row.contact.name,
    contactEmail: row.contact.email,
  };
}

export async function getCurrentBuyer(): Promise<AuthedBuyer | null> {
  const cookieStore = cookies();
  const raw = cookieStore.get(BUYER_SESSION_COOKIE)?.value;
  return getBuyerSessionContact(raw);
}

export async function revokeBuyerSession(rawToken: string, db: AnyDb = defaultDb) {
  const tokenHash = hashToken(rawToken);
  await db.update(buyerSessionTable).set({ revokedAt: new Date() }).where(eq(buyerSessionTable.tokenHash, tokenHash));
}
