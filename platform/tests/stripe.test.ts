import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, accountContact, invoice, payment } from "@/db/schema";
import {
  createCardCheckout,
  processStripeWebhook,
  recordCardPaymentFromStripe,
  StripeNotConfiguredError,
  WebhookError,
} from "@/lib/invoicing/stripe";
import type { BuyerIdentity } from "@/lib/invoicing/service";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

const SAVED_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED_ENV };
});

async function seedAccount(db: TestDb, email = "pat@testbuyer.example") {
  const [acct] = await db
    .insert(account)
    .values({
      legalName: "Test Buyer LLC",
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Pat Buyer",
      primaryContactEmail: email,
    })
    .returning({ id: account.id });
  return acct!.id;
}

async function seedBuyer(db: TestDb, accountId: string): Promise<BuyerIdentity> {
  const [c] = await db
    .insert(accountContact)
    .values({ accountId, name: "Pat Buyer", email: "pat-purchaser@testbuyer.example", roleOnAccount: "purchaser" })
    .returning();
  return {
    accountContactId: c!.id,
    accountId,
    contactName: c!.name,
    contactEmail: c!.email,
    contactRole: "purchaser",
  };
}

async function seedInvoice(db: TestDb, accountId: string, totalMinor: number, status = "sent") {
  const [row] = await db
    .insert(invoice)
    .values({
      invoiceNumber: `FZ-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      accountId,
      lines: [],
      subtotalMinor: totalMinor,
      smallOrderFeeMinor: 0,
      taxMinor: 0,
      totalMinor,
      status,
    })
    .returning();
  return row!;
}

function checkoutCompletedEvent(
  invoiceId: string,
  accountId: string,
  amountMinor: number,
  piId = "pi_test_123",
  paymentStatus: "paid" | "unpaid" = "paid",
) {
  return JSON.stringify({
    id: "evt_test_123",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        payment_intent: piId,
        amount_total: amountMinor,
        payment_status: paymentStatus,
        metadata: { invoiceId, accountId },
      },
    },
  });
}

describe("createCardCheckout", () => {
  it("returns 503 when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedBuyer(db, accountId);
    const inv = await seedInvoice(db, accountId, 100000);
    await expect(createCardCheckout(db, buyer, inv.id)).rejects.toMatchObject({
      status: 503,
    });
    await expect(createCardCheckout(db, buyer, inv.id)).rejects.toBeInstanceOf(StripeNotConfiguredError);
  });

  it("returns 404 when the invoice belongs to another account", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const { db } = await createTestDb();
    const accountA = await seedAccount(db, "a@testbuyer.example");
    const accountB = await seedAccount(db, "b@testbuyer.example");
    const buyerA = await seedBuyer(db, accountA);
    const invB = await seedInvoice(db, accountB, 100000);
    await expect(createCardCheckout(db, buyerA, invB.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses draft invoices", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedBuyer(db, accountId);
    const inv = await seedInvoice(db, accountId, 100000, "draft");
    await expect(createCardCheckout(db, buyer, inv.id)).rejects.toMatchObject({ status: 400 });
  });
});

describe("processStripeWebhook", () => {
  it("records a card payment once even when the same event arrives twice (idempotent)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET; // test-mode bypass
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);

    const raw = checkoutCompletedEvent(inv.id, accountId, 100000);
    const first = await processStripeWebhook(db, raw, null);
    expect(first.handled).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await processStripeWebhook(db, raw, null);
    expect(second.handled).toBe(true);
    expect(second.duplicate).toBe(true);

    const rows = await db.select().from(payment).where(eq(payment.invoiceId, inv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("card");
    expect(rows[0]!.reference).toBe("pi_test_123");
    expect(rows[0]!.fundsClearedAt).not.toBeNull(); // card clears immediately
    expect(rows[0]!.recordedBy).toBeNull(); // automatic, no human owner

    const [updated] = await db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(updated!.status).toBe("paid");
  });

  it("treats payment_intent.succeeded for the same payment as a duplicate", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);

    await processStripeWebhook(db, checkoutCompletedEvent(inv.id, accountId, 100000), null);
    const piEvent = JSON.stringify({
      id: "evt_test_456",
      type: "payment_intent.succeeded",
      data: {
        object: { id: "pi_test_123", amount_received: 100000, metadata: { invoiceId: inv.id } },
      },
    });
    const result = await processStripeWebhook(db, piEvent, null);
    expect(result.duplicate).toBe(true);

    const rows = await db.select().from(payment).where(eq(payment.invoiceId, inv.id));
    expect(rows).toHaveLength(1);
  });

  it("leaves a partially-paid invoice partial after a partial card payment", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);
    await processStripeWebhook(db, checkoutCompletedEvent(inv.id, accountId, 40000), null);
    const [updated] = await db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(updated!.status).toBe("partial");
  });

  it("rejects a missing signature when the webhook secret is set (400)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);
    const raw = checkoutCompletedEvent(inv.id, accountId, 100000);
    await expect(processStripeWebhook(db, raw, null)).rejects.toMatchObject({ status: 400 });
    await expect(processStripeWebhook(db, raw, null)).rejects.toBeInstanceOf(WebhookError);
  });

  it("rejects an invalid signature when the webhook secret is set (400)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);
    const raw = checkoutCompletedEvent(inv.id, accountId, 100000);
    await expect(processStripeWebhook(db, raw, "t=123,v1=bogus")).rejects.toMatchObject({ status: 400 });
  });

  it("ignores unrelated event types", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = await createTestDb();
    const raw = JSON.stringify({ id: "evt_x", type: "customer.created", data: { object: {} } });
    const result = await processStripeWebhook(db, raw, null);
    expect(result.handled).toBe(false);
  });

  it("400s on a card event for an unknown invoice", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = await createTestDb();
    const raw = checkoutCompletedEvent("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", 100);
    await expect(processStripeWebhook(db, raw, null)).rejects.toMatchObject({ status: 400 });
  });

  it("recordCardPaymentFromStripe refuses events for void invoices", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000, "void");
    await expect(
      recordCardPaymentFromStripe(db, { invoiceId: inv.id, amountMinor: 100000, paymentIntentId: "pi_x" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("review hardening 2026-09-23", () => {
  it("ignores checkout.session.completed until payment_status is paid", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);
    const result = await processStripeWebhook(
      db,
      checkoutCompletedEvent(inv.id, accountId, 100000, "pi_unpaid", "unpaid"),
      null,
    );
    expect(result.handled).toBe(false);
    const rows = await db.select().from(payment).where(eq(payment.invoiceId, inv.id));
    expect(rows).toHaveLength(0);
  });

  it("concurrent deliveries of the same PaymentIntent record exactly one payment", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 100000);
    const facts = { invoiceId: inv.id, amountMinor: 100000, paymentIntentId: "pi_race" };
    const results = await Promise.all([
      recordCardPaymentFromStripe(db, facts),
      recordCardPaymentFromStripe(db, facts),
    ]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const rows = await db.select().from(payment).where(eq(payment.invoiceId, inv.id));
    expect(rows).toHaveLength(1);
  });
});
