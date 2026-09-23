import { eq, and, isNull, gt } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { buyerMagicLink, accountContact } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/crypto";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Buyer login path, mirroring lib/auth/magicLink.ts's owner flow but
 * scoped to account_contact rows — which only exist for approved accounts
 * (db/schema/account.ts: an account is created only on application
 * approval). Returns null silently for an unknown email so the request
 * handler can give an identical response either way, same non-disclosure
 * principle as the owner path.
 */
export async function createBuyerMagicLink(email: string, db: AnyDb = defaultDb): Promise<{ raw: string; accountContactId: string; accountId: string } | null> {
  const rows = await db.select().from(accountContact).where(eq(accountContact.email, email)).limit(1);
  const contact = rows[0];
  // Disabled contacts silently get nothing — same non-disclosure shape as unknown emails.
  if (!contact || !contact.active) return null;

  const ttlMinutes = await getSetting<number>(SETTINGS_KEYS.buyerMagicLinkTtlMinutes, 15, db);
  const raw = generateToken();
  await db.insert(buyerMagicLink).values({
    accountContactId: contact.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  });
  return { raw, accountContactId: contact.id, accountId: contact.accountId };
}

export async function consumeBuyerMagicLink(raw: string, db: AnyDb = defaultDb): Promise<{ accountContactId: string; accountId: string } | null> {
  const tokenHash = hashToken(raw);
  const now = new Date();
  // Atomic single-use consume (see lib/auth/magicLink.ts).
  const [link] = await db
    .update(buyerMagicLink)
    .set({ usedAt: now })
    .where(and(eq(buyerMagicLink.tokenHash, tokenHash), isNull(buyerMagicLink.usedAt), gt(buyerMagicLink.expiresAt, now)))
    .returning({ accountContactId: buyerMagicLink.accountContactId });
  if (!link) return null;
  const [contact] = await db
    .select()
    .from(accountContact)
    .where(eq(accountContact.id, link.accountContactId))
    .limit(1);
  // A contact disabled after the link was issued cannot complete login.
  if (!contact || !contact.active) return null;
  return { accountContactId: contact.id, accountId: contact.accountId };
}
