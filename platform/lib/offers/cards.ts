import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, isNull } from "drizzle-orm";
import { account } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { appBaseUrl, OfferError } from "./context";
import { cardGateway, type CardGateway } from "./payments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Card on file (docs/allocation-design.md §4). Stripe holds the card; we
 * keep the payment method id plus brand / last 4 / expiry for display.
 */

export type SavedCard = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; updatedAt: string | null };

export async function getSavedCard(db: AnyDb, accountId: string): Promise<SavedCard | null> {
  const [a] = await db.select().from(account).where(eq(account.id, accountId)).limit(1);
  if (!a?.cardPaymentMethodId) return null;
  return {
    brand: a.cardBrand,
    last4: a.cardLast4,
    expMonth: a.cardExpMonth,
    expYear: a.cardExpYear,
    updatedAt: a.cardUpdatedAt?.toISOString() ?? null,
  };
}

/** The account's Stripe customer, created once (idempotent per account). */
export async function ensureStripeCustomer(db: AnyDb, accountId: string, gateway: CardGateway): Promise<string> {
  const [a] = await db.select().from(account).where(eq(account.id, accountId)).limit(1);
  if (!a) throw new OfferError("Account not found.", 404);
  if (a.stripeCustomerId) return a.stripeCustomerId;
  const id = await gateway.createCustomer({ email: a.primaryContactEmail, name: a.legalName, accountId: a.id });
  await db.update(account).set({ stripeCustomerId: id }).where(and(eq(account.id, a.id), isNull(account.stripeCustomerId)));
  const [fresh] = await db.select({ id: account.stripeCustomerId }).from(account).where(eq(account.id, a.id)).limit(1);
  return fresh?.id ?? id;
}

/** Stripe Checkout in setup mode: add or replace the card without paying. */
export async function startCardSetup(db: AnyDb, accountId: string, gateway: CardGateway = cardGateway()): Promise<{ url: string }> {
  if (!gateway.configured()) throw new OfferError("Card payments aren't set up yet. Please contact Fanzia.", 503);
  const customerId = await ensureStripeCustomer(db, accountId, gateway);
  return gateway.createSetupCheckout({
    customerId,
    accountId,
    successUrl: `${appBaseUrl()}/member/payment?saved=1`,
    cancelUrl: `${appBaseUrl()}/member/payment`,
  });
}

/** Called from the Stripe webhook when a Checkout saved a card. Idempotent. */
export async function saveCardFromCheckout(db: AnyDb, accountId: string, sessionId: string, gateway: CardGateway = cardGateway()): Promise<boolean> {
  if (!gateway.configured()) return false;
  const card = await gateway.savedCardFromSession(sessionId);
  if (!card) return false;
  const [before] = await db.select().from(account).where(eq(account.id, accountId)).limit(1);
  if (!before) return false;
  if (before.cardPaymentMethodId === card.paymentMethodId) return true;
  await db
    .update(account)
    .set({
      cardPaymentMethodId: card.paymentMethodId,
      cardBrand: card.brand,
      cardLast4: card.last4,
      cardExpMonth: card.expMonth,
      cardExpYear: card.expYear,
      cardUpdatedAt: new Date(),
    })
    .where(eq(account.id, accountId));
  await recordAudit(
    {
      actorType: "system",
      action: "account.card_saved",
      entityType: "account",
      entityId: accountId,
      after: { brand: card.brand, last4: card.last4, replaced: Boolean(before.cardPaymentMethodId) },
    },
    db,
  );
  return true;
}

/** Forget the saved card. The next "Accept & pay" goes through Checkout. */
export async function removeSavedCard(db: AnyDb, accountId: string, actorEmail: string): Promise<void> {
  await db
    .update(account)
    .set({ cardPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null, cardUpdatedAt: new Date() })
    .where(eq(account.id, accountId));
  await recordAudit(
    { actorType: "buyer", action: "account.card_removed", entityType: "account", entityId: accountId, after: { by: actorEmail } },
    db,
  );
}
