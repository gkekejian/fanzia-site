import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  account,
  allocationDrop,
  allocationDropItem,
  allocationOffer,
  HOLDING_OFFER_STATUSES,
  invoice,
  payment,
  refundDue,
  type AllocationDropItemRow,
  type AllocationDropRow,
  type AllocationOfferRow,
  type OrderRequestLine,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/format";
import { sendNotificationEmail } from "@/lib/email/send";
import { notifyOwnersEvent } from "@/lib/notifications";
import { nextInvoiceNumber } from "@/lib/invoicing/sequences";
import { recordCardPaymentFromStripe } from "@/lib/invoicing/stripe";
import { canOrder, normalizeContactRole } from "@/lib/users/contactRoles";
import { suggestSplit } from "./engine";
import {
  accountFacts,
  appBaseUrl,
  formatUnits,
  interestByProduct,
  internalAccountId,
  OfferError,
  productFacts,
  scoreAccounts,
} from "./context";
import { ensureStripeCustomer } from "./cards";
import { cardGateway, checkoutExpiryFor, type CardGateway } from "./payments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Allocation offer lifecycle (docs/allocation-design.md §4, §7, §8).
 *
 * Every state change is a conditional UPDATE on the expected current
 * status, so double clicks, retried webhooks and overlapping deadline runs
 * can never apply a transition twice. Quantity math that could oversell
 * (re-offers) runs in a transaction holding a row lock on the drop item.
 */

export type BuyerActor = { accountId: string; accountContactId: string; contactRole: string; contactEmail: string; contactName: string };

type Deps = { now?: Date; gateway?: CardGateway };

/** Two minutes: long enough for a card charge round trip, short enough to retry after a crash. */
const CHARGE_LOCK_MS = 2 * 60 * 1000;

function offersUrl(): string {
  return `${appBaseUrl()}/member/offers`;
}

function deadlineText(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function loadOffer(db: AnyDb, offerId: string) {
  const [row] = await db
    .select({ offer: allocationOffer, item: allocationDropItem, drop: allocationDrop })
    .from(allocationOffer)
    .innerJoin(allocationDropItem, eq(allocationOffer.itemId, allocationDropItem.id))
    .innerJoin(allocationDrop, eq(allocationOffer.dropId, allocationDrop.id))
    .where(eq(allocationOffer.id, offerId))
    .limit(1);
  return row ?? null;
}

async function paymentsTotal(db: AnyDb, invoiceId: string): Promise<number> {
  const rows = await db.select({ amountMinor: payment.amountMinor }).from(payment).where(eq(payment.invoiceId, invoiceId));
  return rows.reduce((s, r) => s + r.amountMinor, 0);
}

/** Void an offer's invoice, but only when nothing was paid on it. Returns false when payments exist. */
async function voidInvoiceIfUnpaid(db: AnyDb, invoiceId: string | null): Promise<boolean> {
  if (!invoiceId) return true;
  if ((await paymentsTotal(db, invoiceId)) > 0) return false;
  await db
    .update(invoice)
    .set({ status: "void", voidedAt: new Date() })
    .where(and(eq(invoice.id, invoiceId), inArray(invoice.status, ["draft", "sent"])));
  return true;
}

// ── Emails ────────────────────────────────────────────────────────────────

/** One email per buyer listing every offer they just received. */
export async function emailOffers(db: AnyDb, offerIds: string[]): Promise<void> {
  if (offerIds.length === 0) return;
  const rows = await db
    .select({ offer: allocationOffer, item: allocationDropItem, drop: allocationDrop })
    .from(allocationOffer)
    .innerJoin(allocationDropItem, eq(allocationOffer.itemId, allocationDropItem.id))
    .innerJoin(allocationDrop, eq(allocationOffer.dropId, allocationDrop.id))
    .where(inArray(allocationOffer.id, offerIds));
  const facts = await productFacts(db, [...new Set(rows.map((r) => r.item.productId))]);
  const accts = await accountFacts(db, [...new Set(rows.map((r) => r.offer.accountId))]);
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.offer.status !== "offered") continue;
    const list = byAccount.get(r.offer.accountId) ?? [];
    list.push(r);
    byAccount.set(r.offer.accountId, list);
  }
  for (const [accountId, list] of byAccount) {
    const acct = accts.get(accountId);
    if (!acct) continue;
    const lines = list.map((r) => {
      const f = facts.get(r.item.productId);
      return `- ${f?.name ?? "Product"}: ${formatUnits(r.offer.qty, f?.sellUnit ?? "unit")} at ${formatMoney(r.offer.unitPriceMinor)} = ${formatMoney(r.offer.totalMinor)} (accept by ${deadlineText(r.offer.expiresAt!)})`;
    });
    const reoffer = list.some((r) => r.offer.wave > 1);
    await sendNotificationEmail(
      {
        to: acct.email,
        subject: reoffer ? "More Fanzia allocation is available for you" : `Your Fanzia allocation: ${list[0]!.drop.name}`,
        text:
          `You have ${list.length === 1 ? "an allocation offer" : `${list.length} allocation offers`} from Fanzia:\n\n${lines.join("\n")}\n\n` +
          `Each offer is all or nothing. Tap "Accept & pay" to take it; your card on file is charged immediately. ` +
          `If you don't want it, tap Decline so it can go to the next buyer.\n\n${offersUrl()}`,
      },
      "offer.sent",
    );
  }
}

// ── Payment settlement ────────────────────────────────────────────────────

/**
 * Called after any payment is recorded on an invoice (direct charge or
 * Stripe webhook). Idempotent. Marks the offer accepted, or, if the offer
 * was no longer live, refunds the late payment.
 */
export async function onInvoicePaymentRecorded(db: AnyDb, invoiceId: string, deps: Deps = {}): Promise<"none" | "accepted" | "late"> {
  const now = deps.now ?? new Date();
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv?.allocationOfferId) return "none";
  const loaded = await loadOffer(db, inv.allocationOfferId);
  if (!loaded) return "none";
  const { offer, item } = loaded;

  if (offer.status === "accepted") return "accepted";
  if (offer.status === "offered" || offer.status === "paying") {
    if (inv.status !== "paid") return "none"; // partial payment: wait for the rest
    const [updated] = await db
      .update(allocationOffer)
      .set({ status: "accepted", respondedAt: now, chargeStartedAt: null, lastPaymentError: null, updatedAt: now })
      .where(and(eq(allocationOffer.id, offer.id), inArray(allocationOffer.status, ["offered", "paying"])))
      .returning();
    if (!updated) return (await loadOffer(db, offer.id))?.offer.status === "accepted" ? "accepted" : "none";
    await recordAudit(
      {
        actorType: "buyer",
        action: "allocation_offer.accepted",
        entityType: "allocation_offer",
        entityId: offer.id,
        after: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, totalMinor: inv.totalMinor },
      },
      db,
    );
    const facts = (await productFacts(db, [item.productId])).get(item.productId);
    const [acct] = await db.select().from(account).where(eq(account.id, offer.accountId)).limit(1);
    await notifyOwnersEvent(
      {
        type: "offer_paid",
        title: `Offer paid — ${acct?.legalName ?? "buyer"}: ${formatUnits(offer.qty, facts?.sellUnit ?? "unit")} ${facts?.name ?? ""} (${formatMoney(offer.totalMinor)})`,
        body: `${acct?.legalName ?? "A buyer"} accepted and paid invoice ${inv.invoiceNumber} for ${formatMoney(inv.totalMinor)}.`,
        entityType: "allocation_drop",
        entityId: offer.dropId,
      },
      db,
    );
    if (acct?.primaryContactEmail) {
      await sendNotificationEmail(
        {
          to: acct.primaryContactEmail,
          subject: `Paid: Fanzia invoice ${inv.invoiceNumber} (${formatMoney(inv.totalMinor)})`,
          text:
            `Thanks. Your allocation is confirmed and paid:\n\n` +
            `- ${facts?.name ?? "Product"}: ${formatUnits(offer.qty, facts?.sellUnit ?? "unit")} for ${formatMoney(inv.totalMinor)}\n\n` +
            `Invoice ${inv.invoiceNumber}. We order from our supplier now and ship when it arrives. ` +
            `If the supplier ships us less than expected, you're refunded for anything we can't deliver.\n\n${appBaseUrl()}/member/invoices`,
        },
        "offer.paid",
      );
    }
    // A buyer with an open offer isn't offered more until they answer; now
    // that they have, free units (from declines/expiries) can go to them.
    await reofferItem(db, offer.itemId, now);
    return "accepted";
  }
  await handleLatePayment(db, inv, offer, deps);
  return "late";
}

/**
 * Money arrived for an offer that had already closed (its units may have
 * gone to someone else). Record it, refund it in full, and tell everyone.
 * Stock is never double-sold.
 */
async function handleLatePayment(db: AnyDb, inv: typeof invoice.$inferSelect, offer: AllocationOfferRow, deps: Deps) {
  const gateway = deps.gateway ?? cardGateway();
  const paid = await paymentsTotal(db, inv.id);
  if (paid <= 0) return;
  const [created] = await db
    .insert(refundDue)
    .values({
      invoiceId: inv.id,
      accountId: inv.accountId,
      roundId: null,
      amountMinor: paid,
      reason: `Paid after the offer closed (${offer.status}); the units were no longer reserved.`,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) return; // already handled

  const [card] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.invoiceId, inv.id), eq(payment.method, "card")))
    .limit(1);
  let refunded = false;
  if (card?.reference && gateway.configured() && card.amountMinor >= paid) {
    try {
      const refund = await gateway.refund({ paymentIntentId: card.reference, amountMinor: paid, idempotencyKey: `refund_due_${created.id}` });
      await db
        .update(refundDue)
        .set({ status: "refunded", method: "card", stripeRefundId: refund.id, resolvedAt: new Date() })
        .where(eq(refundDue.id, created.id));
      await db.update(invoice).set({ status: "refunded" }).where(eq(invoice.id, inv.id));
      refunded = true;
    } catch (err) {
      await db
        .update(refundDue)
        .set({ status: "failed", method: "card", lastError: (err as Error).message.slice(0, 300) })
        .where(eq(refundDue.id, created.id));
    }
  } else {
    await db.update(refundDue).set({ method: card ? "card" : "manual" }).where(eq(refundDue.id, created.id));
  }
  await recordAudit(
    {
      actorType: "system",
      action: refunded ? "allocation_offer.late_payment_refunded" : "allocation_offer.late_payment_refund_pending",
      entityType: "allocation_offer",
      entityId: offer.id,
      after: { invoiceId: inv.id, amountMinor: paid, refundDueId: created.id },
    },
    db,
  );
  await notifyOwnersEvent(
    {
      type: "offer_late_payment",
      title: `Late payment ${refunded ? "refunded" : "needs a refund"}: ${formatMoney(paid)} on ${inv.invoiceNumber}`,
      body:
        `A buyer paid after their offer had closed, so the units were no longer theirs. ` +
        (refunded ? "It was refunded to their card automatically." : "Refund it from the Today page."),
      entityType: "allocation_drop",
      entityId: offer.dropId,
      severity: "warning",
      actionNeeded: !refunded,
      urgent: !refunded,
    },
    db,
  );
  const [acct] = await db.select().from(account).where(eq(account.id, inv.accountId)).limit(1);
  if (acct?.primaryContactEmail) {
    await sendNotificationEmail(
      {
        to: acct.primaryContactEmail,
        subject: `Fanzia refund: ${formatMoney(paid)} (offer had closed)`,
        text:
          `Your payment of ${formatMoney(paid)} on invoice ${inv.invoiceNumber} arrived after the offer had closed, ` +
          `so we couldn't hold those units for you. ` +
          (refunded ? "We've refunded it to your card; it usually shows within 5 to 10 business days." : "We'll refund it and confirm when it's sent."),
      },
      "offer.late_payment",
    );
  }
}

// ── Deadlines + re-offers ─────────────────────────────────────────────────

async function heldOnItem(db: AnyDb, itemId: string): Promise<{ total: number; byAccount: Map<string, number>; accountsWithLive: Set<string> }> {
  const rows = await db
    .select({ accountId: allocationOffer.accountId, qty: allocationOffer.qty, status: allocationOffer.status })
    .from(allocationOffer)
    .where(and(eq(allocationOffer.itemId, itemId), inArray(allocationOffer.status, HOLDING_OFFER_STATUSES)));
  const byAccount = new Map<string, number>();
  const accountsWithLive = new Set<string>();
  let total = 0;
  for (const r of rows) {
    total += r.qty;
    byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + r.qty);
    if (r.status === "offered" || r.status === "paying" || r.status === "proposed") accountsWithLive.add(r.accountId);
  }
  return { total, byAccount, accountsWithLive };
}

/**
 * Offer an item's free units (available − held) to the next buyers in line
 * (docs §7). Runs under a row lock on the item so two overlapping runs can't
 * hand the same units out twice. Returns the offers created.
 */
export async function reofferItem(db: AnyDb, itemId: string, now: Date): Promise<{ offered: string[]; reserved: number; leftover: number }> {
  const result = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(allocationDropItem).where(eq(allocationDropItem.id, itemId)).for("update").limit(1);
    if (!item) return { offered: [] as string[], reserved: 0, leftover: 0, waiting: false, drop: null };
    const [drop] = await tx.select().from(allocationDrop).where(eq(allocationDrop.id, item.dropId)).limit(1);
    if (!drop || drop.status !== "live") return { offered: [], reserved: 0, leftover: 0, waiting: false, drop: null };

    const held = await heldOnItem(tx, item.id);
    const waiting = held.accountsWithLive.size > 0;
    const pool = item.availableQty - held.total;
    if (pool < item.increment) return { offered: [], reserved: 0, leftover: Math.max(0, pool), waiting, drop };

    const passed = await tx
      .select({ accountId: allocationOffer.accountId })
      .from(allocationOffer)
      .where(and(eq(allocationOffer.itemId, item.id), inArray(allocationOffer.status, ["declined", "expired"])));
    const passedSet = new Set(passed.map((p) => p.accountId));

    const interest = (await interestByProduct(tx, [item.productId])).get(item.productId) ?? new Map<string, number>();
    const internalId = await internalAccountId(tx);
    const accts = await accountFacts(tx, [...interest.keys()]);
    const externalIds = [...interest.keys()].filter((id) => {
      const a = accts.get(id);
      return a && a.kind === "external" && a.ineligibleReason === null && !passedSet.has(id) && !held.accountsWithLive.has(id);
    });
    const scores = await scoreAccounts(tx, externalIds, now);
    const internalNeed =
      internalId && interest.has(internalId) && accts.get(internalId)?.ineligibleReason === null
        ? Math.max(0, (interest.get(internalId) ?? 0) - (held.byAccount.get(internalId) ?? 0))
        : 0;
    const split = suggestSplit({
      available: pool,
      increment: item.increment,
      internalNeed,
      candidates: externalIds.map((id) => ({
        accountId: id,
        score: scores.get(id)?.total ?? 0,
        need: Math.max(0, (interest.get(id) ?? 0) - (held.byAccount.get(id) ?? 0)),
        tiebreak: accts.get(id)!.createdAt.toISOString(),
      })),
    });

    const [{ maxWave } = { maxWave: 1 }] = await tx
      .select({ maxWave: sql<number>`coalesce(max(${allocationOffer.wave}), 1)` })
      .from(allocationOffer)
      .where(eq(allocationOffer.itemId, item.id));
    const wave = Number(maxWave) + 1;
    const expiresAt = new Date(now.getTime() + drop.reofferWindowHours * 3_600_000);
    const offered: string[] = [];
    if (split.internalQty > 0 && internalId) {
      await tx.insert(allocationOffer).values({
        dropId: drop.id,
        itemId: item.id,
        accountId: internalId,
        qty: split.internalQty,
        unitPriceMinor: item.unitPriceMinor,
        totalMinor: item.unitPriceMinor * split.internalQty,
        status: "reserved",
        wave,
        sentAt: now,
        respondedAt: now,
      });
    }
    for (const a of split.allocations) {
      const score = scores.get(a.accountId) ?? null;
      const [row] = await tx
        .insert(allocationOffer)
        .values({
          dropId: drop.id,
          itemId: item.id,
          accountId: a.accountId,
          qty: a.qty,
          unitPriceMinor: item.unitPriceMinor,
          totalMinor: item.unitPriceMinor * a.qty,
          status: "offered",
          wave,
          score: score?.total ?? null,
          scoreDetail: score,
          sentAt: now,
          expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: allocationOffer.id });
      if (row) offered.push(row.id);
    }
    if (offered.length > 0 || split.internalQty > 0) {
      await recordAudit(
        {
          actorType: "system",
          action: "allocation_drop.reoffered",
          entityType: "allocation_drop",
          entityId: drop.id,
          after: { itemId: item.id, wave, offers: split.allocations, internalQty: split.internalQty, leftover: split.leftover },
        },
        tx,
      );
    }
    return { offered, reserved: split.internalQty, leftover: split.leftover, waiting: waiting || offered.length > 0, drop };
  });

  if (result.offered.length > 0) await emailOffers(db, result.offered);
  if (result.drop && !result.waiting && result.reserved === 0 && result.leftover > 0) {
    // Nobody left who wants them: the owner decides (offer by hand or order less).
    const [row] = await db.select({ productId: allocationDropItem.productId }).from(allocationDropItem).where(eq(allocationDropItem.id, itemId));
    const facts = row ? (await productFacts(db, [row.productId])).get(row.productId) : undefined;
    await notifyOwnersEvent(
      {
        type: "offer_leftover",
        title: `Unclaimed: ${formatUnits(result.leftover, facts?.sellUnit ?? "unit")} of ${facts?.name ?? "a product"} in ${result.drop.name}`,
        body: "Every interested buyer has been offered this product. Offer the rest by hand on the drop page, or order less from the supplier.",
        entityType: "allocation_drop",
        entityId: result.drop.id,
        actionNeeded: true,
      },
      db,
    );
  }
  return { offered: result.offered, reserved: result.reserved, leftover: result.leftover };
}

/**
 * Expire offers whose deadline passed and re-offer their units (docs §8).
 * Safe to run from several places at once. Scope with dropId/offerId/
 * accountId to keep request-path runs cheap.
 */
export async function processOfferDeadlines(
  db: AnyDb,
  opts: Deps & { dropId?: string; offerId?: string; accountId?: string } = {},
): Promise<{ expired: number; reoffered: number; settled: number }> {
  const now = opts.now ?? new Date();
  const gateway = opts.gateway ?? cardGateway();
  const scope = [
    opts.dropId ? eq(allocationOffer.dropId, opts.dropId) : undefined,
    opts.offerId ? eq(allocationOffer.id, opts.offerId) : undefined,
    opts.accountId ? eq(allocationOffer.accountId, opts.accountId) : undefined,
  ].filter(Boolean);
  const due = await db
    .select()
    .from(allocationOffer)
    .where(and(inArray(allocationOffer.status, ["offered", "paying"]), lte(allocationOffer.expiresAt, now), ...scope))
    .limit(500);

  const touchedItems = new Set<string>();
  let expired = 0;
  let settled = 0;
  for (const offer of due) {
    if (offer.status === "paying") {
      // A buyer may still be finishing Stripe Checkout; wait for it to close.
      if (offer.checkoutSessionId && offer.checkoutExpiresAt && offer.checkoutExpiresAt > now) continue;
      // A charge is mid-flight on another request.
      if (offer.chargeStartedAt && now.getTime() - offer.chargeStartedAt.getTime() < CHARGE_LOCK_MS) continue;
      if (offer.invoiceId && (await paymentsTotal(db, offer.invoiceId)) > 0) {
        await onInvoicePaymentRecorded(db, offer.invoiceId, { now, gateway });
        settled++;
        continue;
      }
      if (offer.checkoutSessionId && offer.invoiceId && gateway.configured()) {
        // The webhook may simply be late: ask Stripe before voiding anything.
        try {
          const cs = await gateway.checkoutPayment(offer.checkoutSessionId);
          if (cs.status === "paid") {
            await recordCardPaymentFromStripe(db, { invoiceId: offer.invoiceId, amountMinor: cs.amountMinor, paymentIntentId: cs.paymentIntentId });
            await onInvoicePaymentRecorded(db, offer.invoiceId, { now, gateway });
            settled++;
            continue;
          }
          if (cs.status === "open") continue;
        } catch (err) {
          console.error("[offers] could not check checkout before expiring; will retry", offer.id, (err as Error).message);
          continue;
        }
      }
    }
    const [updated] = await db
      .update(allocationOffer)
      .set({ status: "expired", respondedAt: now, chargeStartedAt: null, updatedAt: now })
      .where(and(eq(allocationOffer.id, offer.id), eq(allocationOffer.status, offer.status)))
      .returning();
    if (!updated) continue;
    await voidInvoiceIfUnpaid(db, offer.invoiceId);
    await recordAudit(
      { actorType: "system", action: "allocation_offer.expired", entityType: "allocation_offer", entityId: offer.id, after: { qty: offer.qty } },
      db,
    );
    expired++;
    touchedItems.add(offer.itemId);
  }

  let reoffered = 0;
  for (const itemId of touchedItems) reoffered += (await reofferItem(db, itemId, now)).offered.length;
  return { expired, reoffered, settled };
}

/**
 * Move a live offer (offered/paying) to declined or cancelled, safely:
 * never while a charge is in flight, never once money arrived, and any
 * open Checkout is closed first so it can't be paid afterwards.
 */
export async function retireLiveOffer(
  db: AnyDb,
  offer: AllocationOfferRow,
  to: "declined" | "cancelled",
  opts: { now: Date; gateway: CardGateway; declineReason?: string | null },
): Promise<"done" | "paid" | "busy" | "changed"> {
  const { now, gateway } = opts;
  if (offer.status !== "offered" && offer.status !== "paying") return "changed";
  if (offer.chargeStartedAt && now.getTime() - offer.chargeStartedAt.getTime() < CHARGE_LOCK_MS) return "busy";
  if (offer.checkoutSessionId) {
    if (!gateway.configured()) return "busy";
    const cs = await gateway.checkoutPayment(offer.checkoutSessionId);
    if (cs.status === "paid" && offer.invoiceId) {
      await recordCardPaymentFromStripe(db, { invoiceId: offer.invoiceId, amountMinor: cs.amountMinor, paymentIntentId: cs.paymentIntentId });
      await onInvoicePaymentRecorded(db, offer.invoiceId, { now, gateway });
      return "paid";
    }
    if (cs.status === "open") await gateway.expireCheckout(offer.checkoutSessionId);
  }
  if (offer.invoiceId && (await paymentsTotal(db, offer.invoiceId)) > 0) {
    await onInvoicePaymentRecorded(db, offer.invoiceId, { now, gateway });
    return "paid";
  }
  const [updated] = await db
    .update(allocationOffer)
    .set({ status: to, respondedAt: now, declineReason: opts.declineReason ?? null, chargeStartedAt: null, updatedAt: now })
    .where(and(eq(allocationOffer.id, offer.id), eq(allocationOffer.status, offer.status)))
    .returning();
  if (!updated) return "changed";
  await voidInvoiceIfUnpaid(db, offer.invoiceId);
  return "done";
}

// ── Buyer actions ─────────────────────────────────────────────────────────

function assertBuyerCanAct(buyer: BuyerActor) {
  if (!canOrder(normalizeContactRole(buyer.contactRole))) {
    throw new OfferError("Your contact role can view offers but not accept or decline them. Ask your account's primary contact.", 403);
  }
}

async function liveOfferForBuyer(db: AnyDb, buyer: BuyerActor, offerId: string, now: Date, gateway: CardGateway) {
  await processOfferDeadlines(db, { offerId, now, gateway });
  const loaded = await loadOffer(db, offerId);
  if (!loaded || loaded.offer.accountId !== buyer.accountId) throw new OfferError("Offer not found.", 404);
  return loaded;
}

export type AcceptResult = { status: "accepted"; invoiceId: string } | { status: "checkout"; url: string };

/**
 * "Accept & pay": charge the saved card; fall back to Stripe Checkout
 * (which saves the card) when there's no card or the charge needs the buyer.
 */
export async function acceptOffer(
  db: AnyDb,
  buyer: BuyerActor,
  offerId: string,
  opts: Deps & { importAcknowledged?: boolean } = {},
): Promise<AcceptResult> {
  const now = opts.now ?? new Date();
  const gateway = opts.gateway ?? cardGateway();
  assertBuyerCanAct(buyer);
  const { offer, item, drop } = await liveOfferForBuyer(db, buyer, offerId, now, gateway);

  if (offer.status === "accepted" && offer.invoiceId) return { status: "accepted", invoiceId: offer.invoiceId };
  if (offer.status !== "offered" && offer.status !== "paying") {
    throw new OfferError(offer.status === "expired" ? "This offer has expired." : "This offer is no longer open.", 409);
  }
  if (!offer.expiresAt || offer.expiresAt <= now) throw new OfferError("This offer has expired.", 409);
  if (drop.status !== "live") throw new OfferError("This drop is closed.", 409);

  const [acct] = await db.select().from(account).where(eq(account.id, buyer.accountId)).limit(1);
  if (!acct) throw new OfferError("Account not found.", 404);
  if (acct.orderingHoldReason) throw new OfferError("Your account is on hold. Please contact Fanzia.", 403);
  if (acct.kind === "external" && acct.taxStatus !== "exempt") {
    throw new OfferError("Your account needs a resale-certificate review before you can accept offers. Please contact Fanzia.", 403);
  }
  const facts = (await productFacts(db, [item.productId])).get(item.productId);
  if (facts?.requiresImportAcknowledgment && !opts.importAcknowledged) {
    throw new OfferError("This is imported product. Please confirm the import notice before paying.", 400);
  }
  if (!gateway.configured()) throw new OfferError("Card payments aren't set up yet. Please contact Fanzia to pay.", 503);

  // Lock + invoice, atomically. The lock stops a double tap from starting two charges.
  const locked = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(allocationOffer)
      .set({ status: "paying", chargeStartedAt: now, updatedAt: now })
      .where(
        and(
          eq(allocationOffer.id, offer.id),
          inArray(allocationOffer.status, ["offered", "paying"]),
          or(isNull(allocationOffer.chargeStartedAt), lt(allocationOffer.chargeStartedAt, new Date(now.getTime() - CHARGE_LOCK_MS))),
        ),
      )
      .returning();
    if (!row) return null;
    let invoiceId = row.invoiceId;
    if (!invoiceId) {
      const line: OrderRequestLine = {
        productId: item.productId,
        sku: facts?.sku ?? "",
        name: facts?.name ?? "Product",
        qtyRequested: row.qty,
        unitPriceMinor: row.unitPriceMinor,
        lineTotalMinor: row.totalMinor,
        currencyCode: facts?.currencyCode ?? "USD",
      };
      const [inv] = await tx
        .insert(invoice)
        .values({
          invoiceNumber: await nextInvoiceNumber(tx),
          accountId: row.accountId,
          lines: [line],
          subtotalMinor: row.totalMinor,
          smallOrderFeeMinor: 0,
          taxMinor: 0,
          totalMinor: row.totalMinor,
          currencyCode: facts?.currencyCode ?? "USD",
          status: "sent",
          sentAt: now,
          allocationOfferId: row.id,
        })
        .returning();
      invoiceId = inv!.id;
      await tx.update(allocationOffer).set({ invoiceId }).where(eq(allocationOffer.id, row.id));
      await recordAudit(
        {
          actorType: "buyer",
          action: "allocation_offer.accept_started",
          entityType: "allocation_offer",
          entityId: row.id,
          after: {
            invoiceId,
            invoiceNumber: inv!.invoiceNumber,
            contactEmail: buyer.contactEmail,
            importAcknowledged: Boolean(opts.importAcknowledged),
          },
        },
        tx,
      );
    }
    return { offer: { ...row, invoiceId }, lockAt: now };
  });
  if (!locked) {
    const again = await loadOffer(db, offer.id);
    if (again?.offer.status === "accepted" && again.offer.invoiceId) return { status: "accepted", invoiceId: again.offer.invoiceId };
    throw new OfferError("A payment for this offer is already in progress. Refresh in a minute.", 409);
  }
  const invoiceId = locked.offer.invoiceId!;
  const release = () =>
    db.update(allocationOffer).set({ chargeStartedAt: null }).where(and(eq(allocationOffer.id, offer.id), eq(allocationOffer.chargeStartedAt, locked.lockAt)));

  try {
    // A previous Checkout for this offer must never stay payable next to a new charge.
    if (locked.offer.checkoutSessionId) {
      const cs = await gateway.checkoutPayment(locked.offer.checkoutSessionId);
      if (cs.status === "paid") {
        await recordCardPaymentFromStripe(db, { invoiceId, amountMinor: cs.amountMinor, paymentIntentId: cs.paymentIntentId });
        await onInvoicePaymentRecorded(db, invoiceId, { now, gateway });
        return { status: "accepted", invoiceId };
      }
      if (cs.status === "open") await gateway.expireCheckout(locked.offer.checkoutSessionId);
      await db.update(allocationOffer).set({ checkoutSessionId: null, checkoutExpiresAt: null }).where(eq(allocationOffer.id, offer.id));
    }

    const customerId = await ensureStripeCustomer(db, acct.id, gateway);

    const metadata = { invoiceId, offerId: offer.id, accountId: acct.id };
    const description = `Fanzia allocation: ${facts?.name ?? "product"} × ${locked.offer.qty}`;
    if (acct.cardPaymentMethodId) {
      const charge = await gateway.chargeSavedCard({
        customerId,
        paymentMethodId: acct.cardPaymentMethodId,
        amountMinor: locked.offer.totalMinor,
        currency: facts?.currencyCode ?? "USD",
        description,
        metadata,
        idempotencyKey: `offer-charge-${offer.id}-${locked.lockAt.getTime()}`,
      });
      if (charge.status === "succeeded") {
        await recordCardPaymentFromStripe(db, { invoiceId, amountMinor: charge.amountMinor, paymentIntentId: charge.paymentIntentId });
        const outcome = await onInvoicePaymentRecorded(db, invoiceId, { now, gateway });
        if (outcome === "accepted") return { status: "accepted", invoiceId };
        throw new OfferError("Your payment went through but the offer had just closed. It's being refunded in full.", 409);
      }
      await db.update(allocationOffer).set({ lastPaymentError: charge.message.slice(0, 300) }).where(eq(allocationOffer.id, offer.id));
    }

    const session = await gateway.createOfferCheckout({
      customerId,
      amountMinor: locked.offer.totalMinor,
      currency: facts?.currencyCode ?? "USD",
      description,
      metadata,
      successUrl: `${offersUrl()}?paid=${offer.id}`,
      cancelUrl: `${offersUrl()}?canceled=${offer.id}`,
      expiresAt: checkoutExpiryFor(locked.offer.expiresAt!, now),
      idempotencyKey: `offer-checkout-${offer.id}-${locked.lockAt.getTime()}`,
    });
    await db
      .update(allocationOffer)
      .set({ checkoutSessionId: session.sessionId, checkoutExpiresAt: session.expiresAt })
      .where(eq(allocationOffer.id, offer.id));
    return { status: "checkout", url: session.url };
  } catch (err) {
    if (err instanceof OfferError) throw err;
    console.error("[offers] accept & pay failed", offer.id, (err as Error).message);
    throw new OfferError("We couldn't reach the card processor. Try again in a minute; you'll never be charged twice for one offer.", 502);
  } finally {
    await release();
  }
}

/** Decline an offer. Its units go straight to the next buyer in line. */
export async function declineOffer(
  db: AnyDb,
  buyer: BuyerActor,
  offerId: string,
  opts: Deps & { reason?: string | null } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const gateway = opts.gateway ?? cardGateway();
  assertBuyerCanAct(buyer);
  const { offer, item } = await liveOfferForBuyer(db, buyer, offerId, now, gateway);
  if (offer.status !== "offered" && offer.status !== "paying") {
    throw new OfferError(offer.status === "accepted" ? "This offer is already paid." : "This offer is no longer open.", 409);
  }
  const reason = opts.reason?.trim() ? opts.reason.trim().slice(0, 500) : null;
  const outcome = await retireLiveOffer(db, offer, "declined", { now, gateway, declineReason: reason });
  if (outcome === "paid") throw new OfferError("This offer is already paid.", 409);
  if (outcome === "busy") throw new OfferError("A payment for this offer is in progress. Refresh in a minute.", 409);
  if (outcome === "changed") throw new OfferError("This offer changed while you were looking at it. Refresh and try again.", 409);
  await recordAudit(
    {
      actorType: "buyer",
      action: "allocation_offer.declined",
      entityType: "allocation_offer",
      entityId: offer.id,
      after: { reason, contactEmail: buyer.contactEmail },
    },
    db,
  );
  const facts = (await productFacts(db, [item.productId])).get(item.productId);
  const [acct] = await db.select({ legalName: account.legalName }).from(account).where(eq(account.id, offer.accountId)).limit(1);
  await notifyOwnersEvent(
    {
      type: "offer_declined",
      title: `Offer declined — ${acct?.legalName ?? "buyer"}: ${formatUnits(offer.qty, facts?.sellUnit ?? "unit")} ${facts?.name ?? ""}`,
      body: `${reason ? `Reason: ${reason}. ` : ""}The units were re-offered to the next buyer in line automatically.`,
      entityType: "allocation_drop",
      entityId: offer.dropId,
    },
    db,
  );
  await reofferItem(db, offer.itemId, now);
}

export type BuyerOfferView = {
  id: string;
  dropName: string;
  productId: string;
  productName: string;
  sku: string;
  sellUnit: string;
  qty: number;
  unitPriceMinor: number;
  totalMinor: number;
  status: AllocationOfferRow["status"];
  expiresAt: string | null;
  respondedAt: string | null;
  invoiceId: string | null;
  requiresImportAcknowledgment: boolean;
  lastPaymentError: string | null;
  checkoutOpen: boolean;
};

/** A buyer's offers: live ones first, then the last 90 days of history. */
export async function listBuyerOffers(db: AnyDb, accountId: string, deps: Deps = {}): Promise<BuyerOfferView[]> {
  const now = deps.now ?? new Date();
  await processOfferDeadlines(db, { accountId, now, gateway: deps.gateway });
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const rows = await db
    .select({ offer: allocationOffer, item: allocationDropItem, drop: allocationDrop })
    .from(allocationOffer)
    .innerJoin(allocationDropItem, eq(allocationOffer.itemId, allocationDropItem.id))
    .innerJoin(allocationDrop, eq(allocationOffer.dropId, allocationDrop.id))
    .where(
      and(
        eq(allocationOffer.accountId, accountId),
        inArray(allocationOffer.status, ["offered", "paying", "accepted", "declined", "expired", "cancelled"]),
        sql`${allocationOffer.updatedAt} >= ${since}`,
      ),
    );
  const facts = await productFacts(db, [...new Set(rows.map((r) => r.item.productId))]);
  const order: Record<string, number> = { offered: 0, paying: 0, accepted: 1, declined: 2, expired: 2, cancelled: 2 };
  return rows
    .map(({ offer, item, drop }) => {
      const f = facts.get(item.productId);
      return {
        id: offer.id,
        dropName: drop.name,
        productId: item.productId,
        productName: f?.name ?? "Product",
        sku: f?.sku ?? "",
        sellUnit: f?.sellUnit ?? "unit",
        qty: offer.qty,
        unitPriceMinor: offer.unitPriceMinor,
        totalMinor: offer.totalMinor,
        status: offer.status,
        expiresAt: offer.expiresAt?.toISOString() ?? null,
        respondedAt: offer.respondedAt?.toISOString() ?? null,
        invoiceId: offer.invoiceId,
        requiresImportAcknowledgment: f?.requiresImportAcknowledgment ?? false,
        lastPaymentError: offer.status === "paying" ? offer.lastPaymentError : null,
        checkoutOpen: Boolean(offer.checkoutSessionId && offer.checkoutExpiresAt && offer.checkoutExpiresAt > now),
      };
    })
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""));
}

export type { AllocationDropRow, AllocationDropItemRow };
