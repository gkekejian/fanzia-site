import Stripe from "stripe";

/**
 * Card-on-file gateway for allocation offers (docs/allocation-design.md
 * §3-§4). Everything that talks to Stripe for offers goes through this
 * interface so the offer lifecycle can be tested with a fake
 * (tests/offers.test.ts) and never needs a live Stripe account.
 *
 * Card numbers never touch Fanzia: Stripe Checkout collects them, Stripe
 * stores them on a Customer, and we keep only the payment method id plus
 * brand / last 4 / expiry for display.
 */

export type ChargeResult =
  | { status: "succeeded"; paymentIntentId: string; amountMinor: number }
  | { status: "needs_checkout"; message: string; paymentIntentId?: string };

export type CardDetails = { paymentMethodId: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

export interface CardGateway {
  configured(): boolean;
  createCustomer(args: { email: string; name: string; accountId: string }): Promise<string>;
  /**
   * Charge the saved card with the buyer present (they just tapped
   * "Accept & pay"): a customer-initiated, on-session charge, never
   * flagged as merchant-initiated. Anything short of an immediate success
   * (declined, needs 3-D Secure, card expired) returns needs_checkout so
   * the buyer can finish in Stripe Checkout instead.
   */
  chargeSavedCard(args: {
    customerId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ChargeResult>;
  /** Checkout for one offer's invoice; saves the card for next time. */
  createOfferCheckout(args: {
    customerId: string;
    amountMinor: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<{ url: string; sessionId: string; expiresAt: Date }>;
  /** Close an open Checkout session so it can no longer be paid. */
  expireCheckout(sessionId: string): Promise<void>;
  /** Has this Checkout session been paid? (Checked before voiding an expired offer.) */
  checkoutPayment(sessionId: string): Promise<{ status: "paid"; paymentIntentId: string; amountMinor: number } | { status: "open" | "expired" | "unpaid" }>;
  /** Checkout in setup mode: save or replace the card without paying anything. */
  createSetupCheckout(args: { customerId: string; accountId: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  /** The payment method a completed setup/payment Checkout session saved. */
  savedCardFromSession(sessionId: string): Promise<CardDetails | null>;
  refund(args: { paymentIntentId: string; amountMinor: number; idempotencyKey: string }): Promise<{ id: string }>;
  /** Cancel an unfinished PaymentIntent (declined or awaiting 3-D Secure) once the buyer moves to Checkout. */
  cancelPaymentIntent(paymentIntentId: string): Promise<void>;
}

/** Stripe requires a Checkout session to live at least 30 minutes. */
export const MIN_CHECKOUT_MINUTES = 31;
/** Stripe's maximum Checkout session lifetime. */
export const MAX_CHECKOUT_HOURS = 23;

/** Checkout closes at the offer deadline, but never sooner than Stripe allows. */
export function checkoutExpiryFor(offerExpiresAt: Date, now: Date): Date {
  const min = now.getTime() + MIN_CHECKOUT_MINUTES * 60_000;
  const max = now.getTime() + MAX_CHECKOUT_HOURS * 3_600_000;
  return new Date(Math.min(max, Math.max(min, offerExpiresAt.getTime())));
}

function cardDetails(pm: Stripe.PaymentMethod | string | null | undefined): CardDetails | null {
  if (!pm || typeof pm === "string") return null;
  return {
    paymentMethodId: pm.id,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
  };
}

/** Real gateway. Constructed lazily so a missing key only fails the call that needs it. */
export class StripeCardGateway implements CardGateway {
  private client: Stripe | null = null;

  configured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  private stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Card payments are not configured (STRIPE_SECRET_KEY is unset).");
    this.client ??= new Stripe(key);
    return this.client;
  }

  async createCustomer(args: { email: string; name: string; accountId: string }): Promise<string> {
    const customer = await this.stripe().customers.create(
      { email: args.email, name: args.name, metadata: { accountId: args.accountId } },
      { idempotencyKey: `customer-${args.accountId}` },
    );
    return customer.id;
  }

  async chargeSavedCard(args: Parameters<CardGateway["chargeSavedCard"]>[0]): Promise<ChargeResult> {
    try {
      const pi = await this.stripe().paymentIntents.create(
        {
          amount: args.amountMinor,
          currency: args.currency.toLowerCase(),
          customer: args.customerId,
          payment_method: args.paymentMethodId,
          payment_method_types: ["card"],
          confirm: true,
          // Buyer is present: on-session. Card-only, so no redirect-based
          // method needs a return_url; 3-D Secure comes back as
          // requires_action and falls through to Checkout.
          description: args.description,
          metadata: args.metadata,
        },
        { idempotencyKey: args.idempotencyKey },
      );
      if (pi.status === "succeeded") return { status: "succeeded", paymentIntentId: pi.id, amountMinor: pi.amount_received };
      return { status: "needs_checkout", message: "Your bank needs you to confirm this payment.", paymentIntentId: pi.id };
    } catch (err) {
      // Card declined / authentication required arrive as StripeCardError.
      const e = err as { type?: string; message?: string; payment_intent?: { id?: string } };
      if (e.type === "StripeCardError") {
        return { status: "needs_checkout", message: e.message ?? "Your card was declined.", paymentIntentId: e.payment_intent?.id };
      }
      throw err;
    }
  }

  async createOfferCheckout(args: Parameters<CardGateway["createOfferCheckout"]>[0]) {
    const session = await this.stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer: args.customerId,
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: { currency: args.currency.toLowerCase(), unit_amount: args.amountMinor, product_data: { name: args.description } },
            quantity: 1,
          },
        ],
        metadata: { ...args.metadata, saveCard: "1" },
        payment_intent_data: { metadata: args.metadata, setup_future_usage: "on_session" },
        expires_at: Math.floor(args.expiresAt.getTime() / 1000),
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
      },
      { idempotencyKey: args.idempotencyKey },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url, sessionId: session.id, expiresAt: new Date((session.expires_at ?? 0) * 1000) };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const session = await this.stripe().checkout.sessions.retrieve(sessionId);
    if (session.status === "open") await this.stripe().checkout.sessions.expire(sessionId);
  }

  async checkoutPayment(sessionId: string) {
    const session = await this.stripe().checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      const pi = session.payment_intent;
      const id = typeof pi === "string" ? pi : pi?.id;
      if (id) return { status: "paid" as const, paymentIntentId: id, amountMinor: session.amount_total ?? 0 };
    }
    if (session.status === "open") return { status: "open" as const };
    if (session.status === "expired") return { status: "expired" as const };
    return { status: "unpaid" as const };
  }

  async createSetupCheckout(args: { customerId: string; accountId: string; successUrl: string; cancelUrl: string }) {
    const session = await this.stripe().checkout.sessions.create({
      mode: "setup",
      customer: args.customerId,
      payment_method_types: ["card"],
      metadata: { accountId: args.accountId, purpose: "save_card" },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url };
  }

  async savedCardFromSession(sessionId: string): Promise<CardDetails | null> {
    const session = await this.stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["setup_intent.payment_method", "payment_intent.payment_method"],
    });
    const si = session.setup_intent;
    if (si && typeof si !== "string") return cardDetails(si.payment_method);
    const pi = session.payment_intent;
    if (pi && typeof pi !== "string") return cardDetails(pi.payment_method);
    return null;
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const pi = await this.stripe().paymentIntents.retrieve(paymentIntentId);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
      await this.stripe().paymentIntents.cancel(paymentIntentId);
    }
  }

  async refund(args: { paymentIntentId: string; amountMinor: number; idempotencyKey: string }) {
    const refund = await this.stripe().refunds.create(
      { payment_intent: args.paymentIntentId, amount: args.amountMinor, reason: "requested_by_customer" },
      { idempotencyKey: args.idempotencyKey },
    );
    return { id: refund.id };
  }
}

let override: CardGateway | null = null;
const real = new StripeCardGateway();

/** The gateway in use. Tests swap in a fake with setCardGatewayForTests. */
export function cardGateway(): CardGateway {
  return override ?? real;
}

export function setCardGatewayForTests(gateway: CardGateway | null): void {
  override = gateway;
}
