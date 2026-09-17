import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { buyerMagicLink, accountContact } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/crypto";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";

/**
 * Buyer login path, mirroring lib/auth/magicLink.ts's owner flow but
 * scoped to account_contact rows — which only exist for approved accounts
 * (db/schema/account.ts: an account is created only on application
 * approval). Returns null silently for an unknown email so the request
 * handler can give an identical response either way, same non-disclosure
 * principle as the owner path.
 */
export async function createBuyerMagicLink(email: string): Promise<{ raw: string; accountContactId: string; accountId: string } | null> {
  const rows = await db.select().from(accountContact).where(eq(accountContact.email, email)).limit(1);
  const contact = rows[0];
  if (!contact) return null;

  const ttlMinutes = await getSetting<number>(SETTINGS_KEYS.buyerMagicLinkTtlMinutes, 15);
  const raw = generateToken();
  await db.insert(buyerMagicLink).values({
    accountContactId: contact.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  });
  return { raw, accountContactId: contact.id, accountId: contact.accountId };
}

export async function consumeBuyerMagicLink(raw: string): Promise<{ accountContactId: string; accountId: string } | null> {
  const tokenHash = hashToken(raw);
  const rows = await db
    .select({ link: buyerMagicLink, contact: accountContact })
    .from(buyerMagicLink)
    .innerJoin(accountContact, eq(buyerMagicLink.accountContactId, accountContact.id))
    .where(and(eq(buyerMagicLink.tokenHash, tokenHash), isNull(buyerMagicLink.usedAt), gt(buyerMagicLink.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await db.update(buyerMagicLink).set({ usedAt: new Date() }).where(eq(buyerMagicLink.id, row.link.id));
  return { accountContactId: row.contact.id, accountId: row.contact.accountId };
}
