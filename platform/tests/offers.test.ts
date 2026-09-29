import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { makeOwner, makePriceEpoch, makeProduct, makeRoute, makeSupplier, seedCurrency, type TestDb } from "./catalogFixtures";
import {
  account,
  accountContact,
  allocationLine,
  allocationOffer,
  buyerInterest,
  invoice,
  payment,
  refundDue,
} from "@/db/schema";

const sentEmails: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email/send", () => ({
  sendNotificationEmail: vi.fn(async (p: { to: string; subject: string; text: string }) => {
    sentEmails.push(p);
  }),
}));
const ownerNotices: { type: string; title: string }[] = [];
vi.mock("@/lib/notifications", () => ({
  notifyOwnersEvent: vi.fn(async (e: { type: string; title: string }) => {
    ownerNotices.push(e);
  }),
}));

import { processStripeWebhook } from "@/lib/invoicing/stripe";
import type { CardGateway, ChargeResult } from "@/lib/offers/payments";
import { setCardGatewayForTests } from "@/lib/offers/payments";
import {
  acceptOffer,
  declineOffer,
  listBuyerOffers,
  processOfferDeadlines,
  type BuyerActor,
} from "@/lib/offers/lifecycle";
import {
  cancelOffer,
  createDrop,
  createSupplierRound,
  getDropDetail,
  sendDrop,
  setDropItem,
  setProposal,
  suggestDrop,
} from "@/lib/offers/drops";
import { OfferError } from "@/lib/offers/context";
import { saveInterest, getInterest } from "@/lib/offers/interest";
import { setSetting } from "@/lib/settings";
import { saveDraftRequest } from "@/lib/catalog/draftRequest";
import { AllocationModeError, recordInvoicePayment, submitDraftRequest, voidInvoice } from "@/lib/invoicing/service";
import { getActionQueue } from "@/lib/ops/today";

// ── Fake card gateway ─────────────────────────────────────────────────────

type Session = { id: string; amountMinor: number; status: "open" | "paid" | "expired"; metadata: Record<string, string>; pi?: string };

class FakeGateway implements CardGateway {
  charges: { amountMinor: number; idempotencyKey: string; metadata: Record<string, string> }[] = [];
  refunds: { paymentIntentId: string; amountMinor: number }[] = [];
  sessions = new Map<string, Session>();
  nextCharge: "succeed" | "decline" = "succeed";
  chargeDelayMs = 0;
  private n = 0;
  configured() {
    return true;
  }
  async createCustomer({ accountId }: { accountId: string }) {
    return `cus_${accountId.slice(0, 8)}`;
  }
  async chargeSavedCard(args: { amountMinor: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<ChargeResult> {
    if (this.chargeDelayMs) await new Promise((r) => setTimeout(r, this.chargeDelayMs));
    if (this.nextCharge === "decline") return { status: "needs_checkout", message: "Your card was declined." };
    this.charges.push(args);
    return { status: "succeeded", paymentIntentId: `pi_charge_${++this.n}`, amountMinor: args.amountMinor };
  }
  async createOfferCheckout(args: { amountMinor: number; metadata: Record<string, string>; expiresAt: Date }) {
    const id = `cs_${++this.n}`;
    this.sessions.set(id, { id, amountMinor: args.amountMinor, status: "open", metadata: args.metadata });
    return { url: `https://checkout.test/${id}`, sessionId: id, expiresAt: args.expiresAt };
  }
  async expireCheckout(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s && s.status === "open") s.status = "expired";
  }
  async checkoutPayment(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s?.status === "paid") return { status: "paid" as const, paymentIntentId: s.pi!, amountMinor: s.amountMinor };
    return { status: (s?.status ?? "expired") as "open" | "expired" };
  }
  async createSetupCheckout() {
    return { url: "https://checkout.test/setup" };
  }
  async savedCardFromSession() {
    return { paymentMethodId: "pm_saved", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 };
  }
  async refund(args: { paymentIntentId: string; amountMinor: number }) {
    this.refunds.push(args);
    return { id: `re_${++this.n}` };
  }
  /** Buyer finishes Checkout: Stripe marks it paid and sends the webhook. */
  pay(sessionId: string): string {
    const s = this.sessions.get(sessionId)!;
    s.status = "paid";
    s.pi = `pi_cs_${sessionId}`;
    return JSON.stringify({
      id: `evt_${sessionId}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          mode: "payment",
          payment_status: "paid",
          amount_total: s.amountMinor,
          payment_intent: s.pi,
          metadata: { ...s.metadata, saveCard: "1" },
        },
      },
    });
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

let db: TestDb;
let gateway: FakeGateway;
let ownerId: string;
const T0 = new Date("2026-10-01T16:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

async function makeBuyer(name: string, opts: { exempt?: boolean; card?: boolean; role?: string; createdAt?: Date; internal?: boolean } = {}) {
  const email = `${name.toLowerCase().replace(/\W/g, "")}@buyer.example`;
  const [acct] = await db
    .insert(account)
    .values({
      legalName: name,
      channelType: "retail_store",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: name,
      primaryContactEmail: email,
      taxStatus: opts.exempt === false ? "pending" : "exempt",
      kind: opts.internal ? "internal" : "external",
      createdAt: opts.createdAt ?? new Date("2026-01-01T00:00:00Z"),
      ...(opts.card ? { cardPaymentMethodId: "pm_existing", cardBrand: "visa", cardLast4: "1111" } : {}),
    })
    .returning();
  const [contact] = await db
    .insert(accountContact)
    .values({ accountId: acct!.id, name, email, roleOnAccount: opts.role ?? "primary" })
    .returning();
  const actor: BuyerActor = {
    accountId: acct!.id,
    accountContactId: contact!.id,
    contactRole: opts.role ?? "primary",
    contactEmail: email,
    contactName: name,
  };
  return { account: acct!, actor };
}

async function want(accountId: string, productId: string, desiredQty: number) {
  await db.insert(buyerInterest).values({ accountId, productId, desiredQty });
}

async function makeItemProduct(opts: { routeType?: "import" | "domestic"; unitsPerCase?: number; sellUnit?: string } = {}) {
  const sup = await makeSupplier(db);
  const p = await makeProduct(db, { unitsPerCase: opts.unitsPerCase ?? null, sellUnit: opts.sellUnit ?? "Booster Box" });
  const route = await makeRoute(db, { productId: p.id, supplierId: sup.id, routeType: opts.routeType ?? "domestic" });
  await makePriceEpoch(db, { productId: p.id, sourcingRouteId: route.id, priceMinor: 10000 });
  return { product: p, supplier: sup };
}

async function offersFor(accountId: string) {
  return db.select().from(allocationOffer).where(eq(allocationOffer.accountId, accountId));
}

async function liveDrop(available: number, wants: [string, number][], opts: { internal?: [string, number] } = {}) {
  const { product: p, supplier: sup } = await makeItemProduct();
  const drop = await createDrop(db, ownerId, { name: "October drop", supplierId: sup.id });
  const item = await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: available, increment: 1 });
  for (const [accountId, qty] of wants) await want(accountId, p.id, qty);
  if (opts.internal) await want(opts.internal[0], p.id, opts.internal[1]);
  await suggestDrop(db, ownerId, drop.id, T0);
  await sendDrop(db, ownerId, drop.id, T0);
  return { drop, item, product: p, supplier: sup };
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seedCurrency(db);
  ownerId = (await makeOwner(db)).userId;
  gateway = new FakeGateway();
  setCardGatewayForTests(gateway);
  sentEmails.length = 0;
  ownerNotices.length = 0;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("sending a drop", () => {
  it("fills internal first, offers the rest by score, skips non-exempt accounts, and emails each buyer once", async () => {
    const internal = await makeBuyer("Fanzia Vending", { internal: true });
    const a = await makeBuyer("Alpha Cards");
    const b = await makeBuyer("Beta Cards");
    const pending = await makeBuyer("Pending Tax Co", { exempt: false });
    const { drop } = await liveDrop(10, [[a.account.id, 4], [b.account.id, 4], [pending.account.id, 4]], { internal: [internal.account.id, 3] });

    const reserved = await offersFor(internal.account.id);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.status).toBe("reserved");
    expect(reserved[0]!.qty).toBe(3);

    const [oa] = await offersFor(a.account.id);
    const [ob] = await offersFor(b.account.id);
    expect(oa!.status).toBe("offered");
    expect(ob!.status).toBe("offered");
    expect(oa!.qty + ob!.qty).toBe(7);
    expect(oa!.expiresAt!.getTime()).toBe(hours(48).getTime());
    expect(await offersFor(pending.account.id)).toHaveLength(0);

    expect(sentEmails.filter((e) => e.to === a.account.primaryContactEmail)).toHaveLength(1);
    expect(sentEmails.some((e) => e.to === internal.account.primaryContactEmail)).toBe(false);
    expect(ownerNotices.some((n) => n.type === "offers_sent")).toBe(true);

    const detail = await getDropDetail(db, drop.id, T0);
    expect(detail.items[0]!.freeQty).toBe(0);
    expect(detail.items[0]!.candidates.find((c) => c.accountId === pending.account.id)!.ineligibleReason).toMatch(/tax review/);
  });

  it("refuses an owner plan that oversells or gives an ineligible buyer stock", async () => {
    const a = await makeBuyer("Alpha Cards");
    const pending = await makeBuyer("Pending Tax Co", { exempt: false });
    const { product: p, supplier: sup } = await makeItemProduct();
    const drop = await createDrop(db, ownerId, { name: "D", supplierId: sup.id });
    const item = await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 5, increment: 1 });
    await expect(setProposal(db, ownerId, drop.id, item.id, [{ accountId: a.account.id, qty: 6 }])).rejects.toThrow(/only 5/);
    await expect(setProposal(db, ownerId, drop.id, item.id, [{ accountId: pending.account.id, qty: 1 }])).rejects.toThrow(/tax review/);
    await setProposal(db, ownerId, drop.id, item.id, [{ accountId: a.account.id, qty: 5 }]);
    await sendDrop(db, ownerId, drop.id, T0);
    await expect(sendDrop(db, ownerId, drop.id, T0)).rejects.toThrow(/draft/);
  });

  it("enforces case increments", async () => {
    const a = await makeBuyer("Alpha Cards");
    const { product: p, supplier: sup } = await makeItemProduct({ unitsPerCase: 6 });
    const drop = await createDrop(db, ownerId, { name: "D", supplierId: sup.id });
    await expect(setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 10, increment: 6 })).rejects.toThrow(/multiple of 6/);
    const item = await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 12, increment: 6 });
    await want(a.account.id, p.id, 11);
    await suggestDrop(db, ownerId, drop.id, T0);
    const [o] = await offersFor(a.account.id);
    expect(o!.qty).toBe(6);
    await expect(setProposal(db, ownerId, drop.id, item.id, [{ accountId: a.account.id, qty: 7 }])).rejects.toThrow(/multiples of 6/);
  });
});

describe("accept & pay", () => {
  it("charges the saved card once, marks the offer accepted and the invoice paid", async () => {
    const a = await makeBuyer("Alpha Cards", { card: true });
    await liveDrop(4, [[a.account.id, 4]]);
    const [offer] = await offersFor(a.account.id);

    const result = await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    expect(result.status).toBe("accepted");
    expect(gateway.charges).toHaveLength(1);
    expect(gateway.charges[0]!.amountMinor).toBe(40000);

    const [after] = await offersFor(a.account.id);
    expect(after!.status).toBe("accepted");
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, after!.invoiceId!));
    expect(inv!.status).toBe("paid");
    expect(inv!.allocationOfferId).toBe(offer!.id);
    expect(inv!.totalMinor).toBe(40000);

    // Tapping again is harmless.
    const again = await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    expect(again.status).toBe("accepted");
    expect(gateway.charges).toHaveLength(1);
    expect(ownerNotices.some((n) => n.type === "offer_paid")).toBe(true);
  });

  it("never charges twice for a double tap", async () => {
    const a = await makeBuyer("Alpha Cards", { card: true });
    await liveDrop(4, [[a.account.id, 4]]);
    const [offer] = await offersFor(a.account.id);
    gateway.chargeDelayMs = 30;
    const results = await Promise.allSettled([
      acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway }),
      acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway }),
    ]);
    expect(gateway.charges).toHaveLength(1);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const pays = await db.select().from(payment);
    expect(pays).toHaveLength(1);
    const invs = await db.select().from(invoice);
    expect(invs).toHaveLength(1);
  });

  it("falls back to Checkout without a card, then the webhook accepts the offer and saves the card", async () => {
    const a = await makeBuyer("Alpha Cards");
    await liveDrop(4, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    const result = await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    expect(result.status).toBe("checkout");
    const [paying] = await offersFor(a.account.id);
    expect(paying!.status).toBe("paying");

    await processStripeWebhook(db, gateway.pay(paying!.checkoutSessionId!), null);
    const [done] = await offersFor(a.account.id);
    expect(done!.status).toBe("accepted");
    const [acct] = await db.select().from(account).where(eq(account.id, a.account.id));
    expect(acct!.cardPaymentMethodId).toBe("pm_saved");
    expect(acct!.cardLast4).toBe("4242");
  });

  it("sends a declined card to Checkout and keeps the reason", async () => {
    const a = await makeBuyer("Alpha Cards", { card: true });
    await liveDrop(4, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    gateway.nextCharge = "decline";
    const result = await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    expect(result.status).toBe("checkout");
    const [row] = await offersFor(a.account.id);
    expect(row!.lastPaymentError).toMatch(/declined/);
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  it("a retry after an abandoned Checkout closes the old session before charging", async () => {
    const a = await makeBuyer("Alpha Cards");
    await liveDrop(4, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    const [first] = await offersFor(a.account.id);
    await db.update(account).set({ cardPaymentMethodId: "pm_new" }).where(eq(account.id, a.account.id));
    const result = await acceptOffer(db, a.actor, offer!.id, { now: hours(2), gateway });
    expect(result.status).toBe("accepted");
    expect(gateway.sessions.get(first!.checkoutSessionId!)!.status).toBe("expired");
    expect(await db.select().from(invoice)).toHaveLength(1);
  });

  it("blocks view-only contacts, held accounts and missing import acknowledgments", async () => {
    const viewer = await makeBuyer("Viewer Co", { role: "viewer", card: true });
    const held = await makeBuyer("Held Co", { card: true });
    const { product: p, supplier: sup } = await makeItemProduct({ routeType: "import" });
    const drop = await createDrop(db, ownerId, { name: "Import drop", supplierId: sup.id });
    const item = await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 4, increment: 1 });
    // viewer has no buying contact, so the owner can't even propose it
    await expect(setProposal(db, ownerId, drop.id, item.id, [{ accountId: viewer.account.id, qty: 1 }])).rejects.toThrow(/No active contact/);
    await setProposal(db, ownerId, drop.id, item.id, [{ accountId: held.account.id, qty: 2 }]);
    await sendDrop(db, ownerId, drop.id, T0);
    const [offer] = await offersFor(held.account.id);

    await expect(acceptOffer(db, held.actor, offer!.id, { now: hours(1), gateway })).rejects.toThrow(/import notice/);
    await db.update(account).set({ orderingHoldReason: "Card dispute" }).where(eq(account.id, held.account.id));
    await expect(acceptOffer(db, held.actor, offer!.id, { now: hours(1), gateway, importAcknowledged: true })).rejects.toThrow(/on hold/);
    await expect(acceptOffer(db, { ...held.actor, contactRole: "viewer" }, offer!.id, { now: hours(1), gateway })).rejects.toThrow(/can view offers/);
    await expect(acceptOffer(db, viewer.actor, offer!.id, { now: hours(1), gateway })).rejects.toThrow();
    expect(gateway.charges).toHaveLength(0);
  });
});

describe("declines, deadlines and re-offers", () => {
  it("re-offers a declined offer to the next buyer with a 24h window", async () => {
    const a = await makeBuyer("Alpha Cards", { createdAt: new Date("2025-01-01T00:00:00Z") });
    const b = await makeBuyer("Beta Cards", { card: true });
    await liveDrop(4, [[a.account.id, 4], [b.account.id, 4]]);
    const [oa] = await offersFor(a.account.id);
    const [ob] = await offersFor(b.account.id);
    expect(oa!.qty + ob!.qty).toBe(4);

    await declineOffer(db, a.actor, oa!.id, { now: hours(2), gateway, reason: "Too much right now" });
    // Beta still has an open offer: one live offer per buyer per product, so
    // the freed units wait for Beta to answer (no "unclaimed" alert meanwhile).
    expect(await offersFor(b.account.id)).toHaveLength(1);
    expect(ownerNotices.some((n) => n.type === "offer_leftover")).toBe(false);

    await acceptOffer(db, b.actor, ob!.id, { now: hours(2), gateway });
    const bOffers = await offersFor(b.account.id);
    expect(bOffers).toHaveLength(2);
    const wave2 = bOffers.find((o) => o.wave === 2)!;
    expect(wave2.status).toBe("offered");
    expect(wave2.qty).toBe(oa!.qty);
    expect(wave2.expiresAt!.getTime()).toBe(hours(26).getTime());
    // Alpha passed on this product; it is never re-offered to them.
    expect((await offersFor(a.account.id)).filter((o) => o.status === "offered")).toHaveLength(0);
  });

  it("expires unanswered offers at the deadline, voids the invoice and re-offers", async () => {
    const a = await makeBuyer("Alpha Cards");
    const b = await makeBuyer("Beta Cards");
    await liveDrop(2, [[a.account.id, 2], [b.account.id, 2]]);
    const [first] = await offersFor(a.account.id);
    const [second] = await offersFor(b.account.id);
    expect(first!.qty).toBe(1);
    const firstBuyer = a;
    const other = b;
    // Beta pays for their unit; Alpha's unit comes free at the deadline.
    await db.update(account).set({ cardPaymentMethodId: "pm_b" }).where(eq(account.id, b.account.id));
    await acceptOffer(db, b.actor, second!.id, { now: hours(1), gateway });
    // Started Checkout, then walked away.
    await acceptOffer(db, firstBuyer.actor, first!.id, { now: hours(1), gateway });
    const [paying] = await offersFor(firstBuyer.account.id);
    await gateway.expireCheckout(paying!.checkoutSessionId!);

    expect((await processOfferDeadlines(db, { now: hours(47), gateway })).expired).toBe(0);
    const res = await processOfferDeadlines(db, { now: hours(49), gateway });
    expect(res.expired).toBeGreaterThanOrEqual(1);
    const [expired] = (await offersFor(firstBuyer.account.id)).filter((o) => o.id === first!.id);
    expect(expired!.status).toBe("expired");
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, expired!.invoiceId!));
    expect(inv!.status).toBe("void");
    const reoffered = (await offersFor(other.account.id)).filter((o) => o.status === "offered");
    expect(reoffered.map((o) => [o.qty, o.wave])).toEqual([[1, 2]]);
  });

  it("waits for an open Checkout past the deadline and accepts it if paid", async () => {
    const a = await makeBuyer("Alpha Cards");
    await liveDrop(2, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    await acceptOffer(db, a.actor, offer!.id, { now: hours(47.9), gateway });
    const [paying] = await offersFor(a.account.id);
    expect(paying!.checkoutExpiresAt!.getTime()).toBeGreaterThan(hours(48).getTime());
    expect((await processOfferDeadlines(db, { now: hours(48.1), gateway })).expired).toBe(0);
    // Paid, but the webhook never arrived: the deadline run asks Stripe.
    gateway.pay(paying!.checkoutSessionId!);
    const res = await processOfferDeadlines(db, { now: hours(49), gateway });
    expect(res.settled).toBe(1);
    expect((await offersFor(a.account.id))[0]!.status).toBe("accepted");
  });

  it("refunds a payment that lands after the offer closed", async () => {
    const a = await makeBuyer("Alpha Cards");
    await liveDrop(2, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    const [paying] = await offersFor(a.account.id);
    // Stripe says unpaid & closed at the deadline, then a late payment arrives.
    gateway.sessions.get(paying!.checkoutSessionId!)!.status = "expired";
    await processOfferDeadlines(db, { now: hours(49), gateway });
    expect((await offersFor(a.account.id))[0]!.status).toBe("expired");

    gateway.sessions.get(paying!.checkoutSessionId!)!.status = "open";
    await processStripeWebhook(db, gateway.pay(paying!.checkoutSessionId!), null);
    expect(gateway.refunds).toMatchObject([{ paymentIntentId: `pi_cs_${paying!.checkoutSessionId}`, amountMinor: 20000 }]);
    const [due] = await db.select().from(refundDue);
    expect(due!.status).toBe("refunded");
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, paying!.invoiceId!));
    expect(inv!.status).toBe("refunded");
    expect(ownerNotices.some((n) => n.type === "offer_late_payment")).toBe(true);
    // Replayed webhook: no second refund.
    await processStripeWebhook(db, gateway.pay(paying!.checkoutSessionId!), null);
    expect(gateway.refunds).toHaveLength(1);
  });

  it("counts declines and no-responses against the score, but not owner cancellations", async () => {
    const a = await makeBuyer("Alpha Cards");
    const b = await makeBuyer("Beta Cards");
    const c = await makeBuyer("Gamma Cards");
    const { drop } = await liveDrop(3, [[a.account.id, 1], [b.account.id, 1], [c.account.id, 1]]);
    const [oa] = await offersFor(a.account.id);
    const [oc] = await offersFor(c.account.id);
    await declineOffer(db, a.actor, oa!.id, { now: hours(1), gateway });
    await cancelOffer(db, ownerId, drop.id, oc!.id, { now: hours(1), gateway });
    await processOfferDeadlines(db, { now: hours(49), gateway });

    const detail = await getDropDetail(db, drop.id, hours(50));
    const cand = (id: string) => detail.items[0]!.candidates.find((x) => x.accountId === id)!;
    expect(cand(a.account.id).scoreNotes.join(" ")).toMatch(/Accepted 0 of 1 offers \(1 declined/);
    expect(cand(b.account.id).scoreNotes.join(" ")).toMatch(/1 no response/);
    expect(cand(c.account.id).scoreNotes.join(" ")).toMatch(/No offers answered yet/);
  });
});

describe("live drop quantities and supplier rounds", () => {
  it("won't shrink below what's held, and offers new stock right away", async () => {
    const a = await makeBuyer("Alpha Cards");
    const { drop, product: p } = await liveDrop(2, [[a.account.id, 5]]);
    await expect(setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 1 }, hours(1))).rejects.toThrow(OfferError);
    // Alpha already has a live offer, so the extra units wait for them to answer.
    await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 5 }, hours(1));
    expect((await offersFor(a.account.id)).filter((o) => o.status === "offered")).toHaveLength(1);
    const b = await makeBuyer("Beta Cards");
    await want(b.account.id, p.id, 3);
    await setDropItem(db, ownerId, drop.id, { productId: p.id, availableQty: 5 }, hours(1));
    const res = await (await import("@/lib/offers/drops")).offerLeftovers(db, ownerId, drop.id, (await getDropDetail(db, drop.id, hours(1))).items[0]!.id, hours(1));
    expect(res.offered).toHaveLength(1);
    expect((await offersFor(b.account.id))[0]!.qty).toBe(3);
  });

  it("builds a supplier round from accepted offers and internal reservations only", async () => {
    const internal = await makeBuyer("Fanzia Vending", { internal: true });
    const a = await makeBuyer("Alpha Cards", { card: true });
    const b = await makeBuyer("Beta Cards");
    const { drop, product: p } = await liveDrop(6, [[a.account.id, 2], [b.account.id, 2]], { internal: [internal.account.id, 2] });
    const [oa] = await offersFor(a.account.id);
    const [ob] = await offersFor(b.account.id);
    await acceptOffer(db, a.actor, oa!.id, { now: hours(1), gateway });
    await acceptOffer(db, b.actor, ob!.id, { now: hours(1), gateway }); // checkout, unpaid

    const { roundId, added } = await createSupplierRound(db, ownerId, drop.id);
    expect(added).toBe(1);
    const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, roundId));
    expect(lines.map((l) => [l.accountId, l.requestedQty]).sort()).toEqual(
      [
        [a.account.id, 2],
        [internal.account.id, 2],
      ].sort(),
    );
    expect(lines.every((l) => l.productId === p.id)).toBe(true);
    await expect(createSupplierRound(db, ownerId, drop.id)).rejects.toThrow(/already/);
  });
});

describe("buyer offer list", () => {
  it("shows only the buyer's own offers, live first", async () => {
    const a = await makeBuyer("Alpha Cards");
    const b = await makeBuyer("Beta Cards");
    await liveDrop(4, [[a.account.id, 2], [b.account.id, 2]]);
    const list = await listBuyerOffers(db, a.account.id, { now: hours(1), gateway });
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("offered");
    expect(list[0]!.sellUnit).toBe("Booster Box");
    await expect(
      declineOffer(db, a.actor, (await offersFor(b.account.id))[0]!.id, { now: hours(1), gateway }),
    ).rejects.toThrow(/not found/);
    const rows = await db
      .select()
      .from(allocationOffer)
      .where(and(eq(allocationOffer.accountId, b.account.id), eq(allocationOffer.status, "offered")));
    expect(rows).toHaveLength(1);
  });
});

describe("allocation mode guards", () => {
  it("blocks order submission for external buyers but not the internal account", async () => {
    await setSetting("selling_mode", "allocation", "test", db);
    const a = await makeBuyer("Alpha Cards");
    const internal = await makeBuyer("Fanzia Vending", { internal: true });
    const { product: p } = await makeItemProduct();
    await saveDraftRequest(a.account.id, { lines: [{ productId: p.id, qtyRequested: 10 }], notes: "" }, db);
    await expect(submitDraftRequest(db, a.actor)).rejects.toBeInstanceOf(AllocationModeError);
    await saveDraftRequest(internal.account.id, { lines: [{ productId: p.id, qtyRequested: 10 }], notes: "" }, db);
    const created = await submitDraftRequest(db, internal.actor);
    expect(created.accountId).toBe(internal.account.id);
  });

  it("saves a wants list in whole cases and replaces it on each save", async () => {
    const a = await makeBuyer("Alpha Cards");
    const { product: p } = await makeItemProduct({ unitsPerCase: 6 });
    await expect(saveInterest(db, a.account.id, { lines: [{ productId: p.id, qtyRequested: 5 }] })).rejects.toThrow(/cases of 6/);
    await saveInterest(db, a.account.id, { lines: [{ productId: p.id, qtyRequested: 12 }] });
    expect(await getInterest(db, a.account.id)).toEqual([{ productId: p.id, qtyRequested: 12 }]);
    await saveInterest(db, a.account.id, { lines: [] });
    expect(await getInterest(db, a.account.id)).toEqual([]);
  });

  it("offer invoices can't be voided or paid outside Accept & pay", async () => {
    const a = await makeBuyer("Alpha Cards");
    await liveDrop(2, [[a.account.id, 2]]);
    const [offer] = await offersFor(a.account.id);
    await acceptOffer(db, a.actor, offer!.id, { now: hours(1), gateway });
    const [paying] = await offersFor(a.account.id);
    await expect(voidInvoice(db, paying!.invoiceId!)).rejects.toThrow(/Cancel the offer/);
    await expect(recordInvoicePayment(db, paying!.invoiceId!, ownerId, { amountMinor: 100, method: "ach" })).rejects.toThrow(/Accept & pay/);
  });

  it("puts unclaimed units on Today once every interested buyer has answered", async () => {
    const a = await makeBuyer("Alpha Cards");
    const { drop } = await liveDrop(4, [[a.account.id, 2]]);
    let queue = await getActionQueue(db, hours(1));
    expect(queue.some((i) => i.id.startsWith(`drop-free:${drop.id}`))).toBe(false);
    const [offer] = await offersFor(a.account.id);
    await declineOffer(db, a.actor, offer!.id, { now: hours(2), gateway });
    queue = await getActionQueue(db, hours(2));
    const item = queue.find((i) => i.id.startsWith(`drop-free:${drop.id}`));
    expect(item?.title).toMatch(/^4 unclaimed/);
    expect(ownerNotices.some((n) => n.type === "offer_leftover")).toBe(true);
  });
});
