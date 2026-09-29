import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db as defaultDb } from "@/db/client";
import { account, invoice, payment } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/format";
import { balanceDue, invoiceCleared } from "./rules";
import { InvoicingError, type BuyerIdentity } from "./service";
import { notifyOwnersEvent } from "@/lib/notifications";

export { InvoicingError };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Stripe card payments (test-mode ready).
 *
 * Env vars (documented here; values come from the environment, never
 * hardcoded):
 * - STRIPE_SECRET_KEY: secret key used to create Checkout Sessions.
 *   When unset, card checkout returns 503 ("not configured yet") — the
 *   platform keeps working with manual ACH/wire recording.
 * - STRIPE_WEBHOOK_SECRET: signing secret used to verify the
 *   /api/webhooks/stripe endpoint. Verification is skipped only when the
 *   secret is unset AND NODE_ENV=test (the automated suite has no Stripe
 *   account); in every other configuration a missing/invalid signature is
 *   a 400.
 *
 * Manual recording of ACH/wire payments (lib/invoicing/service.ts) is
 * unchanged and remains the fallback for non-card methods.
 */

export class StripeNotConfiguredError extends InvoicingError {
  constructor() {
    super("Card payments are not configured yet. Please contact Fanzia for alternative payment methods.", 503);
  }
}

export class WebhookError extends InvoicingError {}

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  return new Stripe(key);
}

function getWebhookClient(): Stripe {
  // Signature verification never calls the Stripe API, so any key string
  // works — webhooks must verify even before STRIPE_SECRET_KEY is configured.
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_webhook_only");
}

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}

/**
 * Create a card-only Checkout Session for the remaining balance of an
 * invoice. The invoice must belong to the buyer's account and be in a
 * payable state (sent/partial — never draft or void).
 */
export async function createCardCheckout(db: AnyDb, buyer: BuyerIdentity, invoiceId: string) {
  const stripe = getStripeClient(); // 503 before any validation, so "not configured" is unambiguous

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  // 404 either way: never reveal another account's invoices to a buyer.
  if (!inv || inv.accountId !== buyer.accountId) {
    throw new InvoicingError("Invoice not found.", 404);
  }
  if (inv.status === "void") throw new InvoicingError("This invoice was voided.", 400);
  if (inv.status === "draft") throw new InvoicingError("This invoice has not been sent yet.", 400);
  if (inv.status === "paid") throw new InvoicingError("This invoice is already paid.", 400);

  const existing = await db.select().from(payment).where(eq(payment.invoiceId, invoiceId));
  const balance = balanceDue(inv.totalMinor, existing);
  if (balance <= 0) throw new InvoicingError("There is no remaining balance on this invoice.", 400);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: (inv.currencyCode || "USD").toLowerCase(),
          unit_amount: balance,
          product_data: { name: `Fanzia wholesale invoice ${inv.invoiceNumber}` },
        },
        quantity: 1,
      },
    ],
    metadata: { invoiceId: inv.id, accountId: inv.accountId },
    // Copy the invoice id onto the PaymentIntent too. Without this,
    // payment_intent.* events carry empty metadata, so failed-card
    // notifications (payment_intent.payment_failed) could never match an
    // invoice and were silently dropped.
    payment_intent_data: { metadata: { invoiceId: inv.id, accountId: inv.accountId } },
    success_url: `${baseUrl()}/member/invoices?paid=1&invoice=${inv.id}`,
    cancel_url: `${baseUrl()}/member/invoices?canceled=1&invoice=${inv.id}`,
  });

  if (!session.url) throw new InvoicingError("Stripe did not return a checkout URL.", 502);
  return { url: session.url, sessionId: session.id, amountMinor: balance };
}

type StripePaymentFacts = {
  invoiceId: string;
  amountMinor: number;
  paymentIntentId: string;
};

function factsFromEvent(event: Stripe.Event): StripePaymentFacts | null {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoiceId;
    if (!invoiceId) return null;
    // "completed" means the buyer finished the Checkout page, not that money
    // moved. Only record a payment once Stripe reports it as paid.
    if (session.payment_status !== "paid") return null;
    const pi = session.payment_intent;
    const paymentIntentId = typeof pi === "string" ? pi : pi?.id ?? `cs_${session.id}`;
    return { invoiceId, amountMinor: session.amount_total ?? 0, paymentIntentId };
  }
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const invoiceId = pi.metadata?.invoiceId;
    if (!invoiceId || !pi.id) return null;
    return { invoiceId, amountMinor: pi.amount_received ?? 0, paymentIntentId: pi.id };
  }
  return null;
}

/**
 * A completed Checkout that saved a card: setup mode ("save my card") or an
 * offer payment made with setup_future_usage.
 */
function cardSaveFromEvent(event: Stripe.Event): { accountId: string; sessionId: string; setupOnly: boolean } | null {
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data.object as Stripe.Checkout.Session;
  const accountId = session.metadata?.accountId;
  if (!accountId) return null;
  if (session.mode === "setup" && session.metadata?.purpose === "save_card") {
    return { accountId, sessionId: session.id, setupOnly: true };
  }
  if (session.metadata?.saveCard === "1" && session.payment_status === "paid") {
    return { accountId, sessionId: session.id, setupOnly: false };
  }
  return null;
}

type StripeFailureFacts = {
  invoiceId: string;
  amountMinor: number;
  paymentIntentId: string;
  failureMessage: string | null;
};

/** Extract the facts for a failed card payment attempt, if it references one of our invoices. */
function failureFactsFromEvent(event: Stripe.Event): StripeFailureFacts | null {
  if (event.type !== "payment_intent.payment_failed") return null;
  const pi = event.data.object as Stripe.PaymentIntent;
  const invoiceId = pi.metadata?.invoiceId;
  if (!invoiceId || !pi.id) return null;
  const failureMessage = pi.last_payment_error?.message ?? null;
  return { invoiceId, amountMinor: pi.amount ?? 0, paymentIntentId: pi.id, failureMessage };
}

/**
 * Idempotently record a card payment from a Stripe webhook event. The
 * payment_intent id is the idempotency key: a repeated event (Stripe
 * retries, or both checkout.session.completed and payment_intent.succeeded
 * firing for the same payment) records exactly one payment row. Card
 * payments clear immediately.
 */
export async function recordCardPaymentFromStripe(db: AnyDb, facts: StripePaymentFacts) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoice).where(eq(invoice.id, facts.invoiceId)).limit(1);
    if (!inv) throw new WebhookError(`Invoice ${facts.invoiceId} from Stripe event not found.`, 400);
    // An allocation-offer invoice is voided when its offer closes. Money can
    // still arrive afterwards (a Checkout finished at the deadline, a slow
    // webhook): record it so lib/offers/lifecycle.ts can refund it in full.
    // Any other void invoice is refused as before.
    if (inv.status === "void" && !inv.allocationOfferId) {
      throw new WebhookError("Stripe event for a void invoice; refusing to record.", 400);
    }
    if (facts.amountMinor <= 0) throw new WebhookError("Stripe event carried a non-positive amount.", 400);

    const findExisting = async () => {
      const [row] = await tx
        .select()
        .from(payment)
        .where(
          and(
            eq(payment.invoiceId, facts.invoiceId),
            eq(payment.method, "card"),
            eq(payment.reference, facts.paymentIntentId),
          ),
        )
        .limit(1);
      return row;
    };
    const dup = await findExisting();
    if (dup) return { payment: dup, invoice: inv, duplicate: true as const };

    const now = new Date();
    // ON CONFLICT DO NOTHING against payment_card_reference_uniq (migration
    // 0028): if a concurrent delivery of the same event won the race, the
    // insert returns no row and we report a duplicate instead of
    // double-crediting the invoice.
    const [created] = await tx
      .insert(payment)
      .values({
        invoiceId: inv.id,
        accountId: inv.accountId,
        amountMinor: facts.amountMinor,
        method: "card",
        reference: facts.paymentIntentId,
        paidAt: now,
        fundsClearedAt: now, // card clears immediately
        recordedBy: null, // automatic: no human owner recorded this
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const existing = await findExisting();
      return { payment: existing!, invoice: inv, duplicate: true as const };
    }

    const all = await tx.select().from(payment).where(eq(payment.invoiceId, inv.id));
    const status =
      inv.status === "void" || inv.status === "refunded" ? inv.status : invoiceCleared(inv.totalMinor, all) ? "paid" : "partial";
    const [updated] = await tx.update(invoice).set({ status }).where(eq(invoice.id, inv.id)).returning();

    await recordAudit(
      {
        actorType: "system",
        action: "invoice.stripe_payment_recorded",
        entityType: "payment",
        entityId: created.id,
        after: {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amountMinor: facts.amountMinor,
          paymentIntentId: facts.paymentIntentId,
          invoiceStatus: status,
        },
      },
      tx,
    );
    return { payment: created, invoice: updated!, duplicate: false as const };
  });
}

/**
 * Verify and dispatch a raw Stripe webhook body. Returns { handled } for
 * known event types and { ignored } for everything else. Throws
 * WebhookError (with .status) on verification or processing failures.
 */
export async function processStripeWebhook(
  db: AnyDb,
  rawBody: string,
  signature: string | null,
): Promise<{ handled: boolean; duplicate?: boolean }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;
  if (!secret) {
    // Test-only bypass: the automated suite has no Stripe account and no
    // signing secret. Every other configuration requires a signature.
    if (process.env.NODE_ENV !== "test") {
      throw new WebhookError("Stripe webhook is not configured.", 400);
    }
    try {
      event = JSON.parse(rawBody) as Stripe.Event;
    } catch {
      throw new WebhookError("Invalid webhook payload.", 400);
    }
  } else {
    if (!signature) throw new WebhookError("Missing Stripe signature.", 400);
    try {
      event = getWebhookClient().webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new WebhookError("Invalid Stripe signature.", 400);
    }
  }

  const dispute = disputeFactsFromEvent(event);
  if (dispute) {
    await handleDispute(db, dispute);
    return { handled: true };
  }

  const cardSave = cardSaveFromEvent(event);
  if (cardSave) {
    const { saveCardFromCheckout } = await import("@/lib/offers/cards");
    await saveCardFromCheckout(db, cardSave.accountId, cardSave.sessionId);
    if (cardSave.setupOnly) return { handled: true };
  }

  const facts = factsFromEvent(event);
  if (!facts) {
    // A failed card attempt is not a payment — but the owners need to know
    // it happened (severity warning) so they can follow up with the buyer.
    const failure = failureFactsFromEvent(event);
    if (failure) {
      const [inv] = await db.select().from(invoice).where(eq(invoice.id, failure.invoiceId)).limit(1);
      // A declined "Accept & pay" charge falls back to Checkout with the
      // buyer present; the offer page shows the reason. Not an owner task.
      if (inv?.allocationOfferId) return { handled: true };
      await notifyOwnersEvent(
        {
          type: "payment_failed",
          title: `Card payment failed — ${inv ? inv.invoiceNumber : failure.invoiceId}`,
          body:
            `A card payment attempt of ${formatMoney(failure.amountMinor)} failed ` +
            (inv ? `on invoice ${inv.invoiceNumber}` : `for invoice ${failure.invoiceId}`) +
            (failure.failureMessage ? `: ${failure.failureMessage}` : ".") +
            ` No payment was recorded.`,
          entityType: inv ? "invoice" : null,
          entityId: inv ? inv.id : null,
          severity: "warning",
        },
        db,
      );
      return { handled: true };
    }
    return { handled: false }; // unknown event type, or card event without our metadata
  }
  const result = await recordCardPaymentFromStripe(db, facts);
  if (result.invoice.allocationOfferId) {
    // Offer invoices: acceptance (or a late-payment refund) sends its own notices.
    const { onInvoicePaymentRecorded } = await import("@/lib/offers/lifecycle");
    await onInvoicePaymentRecorded(db, result.invoice.id);
    return { handled: true, duplicate: result.duplicate };
  }
  if (!result.duplicate) {
    await notifyOwnersEvent(
      {
        type: "invoice_paid",
        title: `Card payment received — ${result.invoice.invoiceNumber} (${formatMoney(facts.amountMinor)})`,
        body:
          `A card payment of ${formatMoney(facts.amountMinor)} was received via Stripe ` +
          `on invoice ${result.invoice.invoiceNumber}. Invoice status is now "${result.invoice.status}".`,
        entityType: "invoice",
        entityId: result.invoice.id,
      },
      db,
    );
  }
  return { handled: true, duplicate: result.duplicate };
}

/**
 * Partial or full refund of a card payment (supplier shortfall). The
 * idempotency key makes a retried call return the same refund instead of
 * refunding twice.
 */
export async function refundCardPayment(args: {
  paymentIntentId: string;
  amountMinor: number;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  const stripe = getStripeClient();
  const refund = await stripe.refunds.create(
    { payment_intent: args.paymentIntentId, amount: args.amountMinor, reason: "requested_by_customer" },
    { idempotencyKey: args.idempotencyKey },
  );
  return { id: refund.id };
}

type DisputeFacts = { paymentIntentId: string | null; amountMinor: number; reason: string; disputeId: string };

function disputeFactsFromEvent(event: Stripe.Event): DisputeFacts | null {
  if (event.type !== "charge.dispute.created") return null;
  const d = event.data.object as Stripe.Dispute;
  const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id ?? null;
  return { paymentIntentId: pi, amountMinor: d.amount ?? 0, reason: d.reason ?? "unknown", disputeId: d.id };
}

/**
 * Contingency: a card chargeback. Wholesale sealed product is a fraud
 * target, so the buyer's account is put on an ordering hold immediately
 * (no new orders, no auto-approval) and both owners get an urgent alert
 * with the Stripe response deadline in mind. Lifting the hold is a
 * deliberate owner action.
 */
export async function handleDispute(db: AnyDb, facts: DisputeFacts): Promise<{ accountId: string | null }> {
  let accountId: string | null = null;
  let invoiceNumber: string | null = null;
  if (facts.paymentIntentId) {
    const [pay] = await db
      .select()
      .from(payment)
      .where(and(eq(payment.method, "card"), eq(payment.reference, facts.paymentIntentId)))
      .limit(1);
    if (pay) {
      accountId = pay.accountId;
      const [inv] = await db.select().from(invoice).where(eq(invoice.id, pay.invoiceId)).limit(1);
      invoiceNumber = inv?.invoiceNumber ?? null;
      await db
        .update(account)
        .set({ orderingHoldReason: `Card dispute ${facts.disputeId} (${facts.reason})`, orderingHoldAt: new Date() })
        .where(eq(account.id, pay.accountId));
    }
  }
  await recordAudit(
    {
      actorType: "system",
      action: "payment.disputed",
      entityType: "account",
      entityId: accountId,
      after: { disputeId: facts.disputeId, amountMinor: facts.amountMinor, reason: facts.reason, invoiceNumber },
    },
    db,
  );
  await notifyOwnersEvent(
    {
      type: "payment_disputed",
      title: `Card dispute: ${formatMoney(facts.amountMinor)}${invoiceNumber ? ` on ${invoiceNumber}` : ""}`,
      body:
        `A buyer disputed a card payment (reason: ${facts.reason}). ` +
        (accountId
          ? `Their account is now on an ordering hold. Do not ship anything unshipped on this account. `
          : `We could not match it to an invoice. `) +
        `Respond in the Stripe dashboard before the evidence deadline (usually 7 to 21 days).`,
      severity: "warning",
      urgent: true,
    },
    db,
  );
  return { accountId };
}

export function stripeCardNote(amountMinor: number): string {
  return `${formatMoney(amountMinor)} paid by card via Stripe. Funds clear immediately.`;
}
