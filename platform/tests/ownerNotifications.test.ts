import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, invoice, notification, shipment, user } from "@/db/schema";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationLinkPath,
  notifyOwnersEvent,
} from "@/lib/notifications";
import { sendInvoice, recordInvoicePayment } from "@/lib/invoicing/service";
import { createShipment, markShipmentShipped } from "@/lib/invoicing/fulfillment";
import { processStripeWebhook } from "@/lib/invoicing/stripe";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

async function seedOwner(db: TestDb, email: string, active = true) {
  const [u] = await db
    .insert(user)
    .values({ email, name: email, role: "owner", active })
    .returning({ id: user.id });
  return u!.id;
}

async function seedAccount(db: TestDb) {
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
      primaryContactEmail: "pat@testbuyer.example",
    })
    .returning({ id: account.id });
  return acct!.id;
}

async function seedInvoice(db: TestDb, accountId: string, ownerId: string, status = "draft") {
  const [row] = await db
    .insert(invoice)
    .values({
      invoiceNumber: `FZ-NOTIF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      accountId,
      lines: [],
      subtotalMinor: 100000,
      smallOrderFeeMinor: 0,
      taxMinor: 0,
      totalMinor: 100000,
      status,
      createdBy: ownerId,
    })
    .returning();
  return row!;
}

beforeEach(() => {
  // The email sender falls back to console logging when no API key is set —
  // that path is what staging uses, and it must never throw.
  delete process.env.RESEND_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("notifyOwnersEvent", () => {
  it("writes a notification row with all fields, unread by default", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await seedOwner(db, "joe@example.com");

    await notifyOwnersEvent(
      {
        type: "application_submitted",
        title: "New wholesale application — Acme Corp",
        body: "Acme Corp applied.",
        actorEmail: "buyer@acme.example",
        entityType: "application",
        entityId: "app-123",
      },
      db,
    );

    const rows = await db.select().from(notification);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe("application_submitted");
    expect(row.title).toBe("New wholesale application — Acme Corp");
    expect(row.actorEmail).toBe("buyer@acme.example");
    expect(row.entityType).toBe("application");
    expect(row.entityId).toBe("app-123");
    expect(row.severity).toBe("info");
    expect(row.readAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("emails every active owner (and nobody else) with a [Fanzia] subject", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await seedOwner(db, "joe@example.com");
    await seedOwner(db, "former@example.com", false); // inactive owner: no mail
    await db.insert(user).values({ email: "agent@example.com", name: "Agent", role: "ai_operator", active: true });

    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      await notifyOwnersEvent(
        { type: "order_placed", title: "New order request — Pat", body: "An order was placed." },
        db,
      );
    } finally {
      spy.mockRestore();
    }

    const recipients = logged
      .filter((line) => line.includes("[email:dev-fallback]"))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))) as { to: string; subject: string })
      .map((p) => p.to)
      .sort();
    expect(recipients).toEqual(["george@example.com", "joe@example.com"]);
    const subjects = logged
      .filter((line) => line.includes("[email:dev-fallback]"))
      .map((line) => (JSON.parse(line.slice(line.indexOf("{"))) as { subject: string }).subject);
    expect(subjects.every((s) => s === "[Fanzia] New order request — Pat")).toBe(true);
  });

  it("stores warning severity when the event is urgent", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await notifyOwnersEvent(
      {
        type: "payment_failed",
        title: "Card payment failed — FZ-1",
        body: "A card payment failed.",
        severity: "warning",
      },
      db,
    );
    const rows = await db.select().from(notification);
    expect(rows[0]!.severity).toBe("warning");
  });

  it("never throws when the notification insert itself fails", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Force the insert to fail: entityId column accepts text, but the
      // severity enum rejects an invalid value — emulate a DB-level
      // failure by passing through the raw insert path with a bad cast.
      await expect(
        notifyOwnersEvent(
          {
            type: "invoice_sent",
            title: "x",
            body: "x",
            // @ts-expect-error deliberate invalid severity to break the insert
            severity: "definitely-not-a-severity",
          },
          db,
        ),
      ).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(
        "[notifications:write-failed]",
        "invoice_sent",
        expect.any(String),
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("notification queries", () => {
  it("lists newest first and filters unread", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");

    await notifyOwnersEvent({ type: "invoice_created", title: "first", body: "1" }, db);
    await new Promise((r) => setTimeout(r, 5));
    await notifyOwnersEvent({ type: "invoice_sent", title: "second", body: "2" }, db);

    const all = await listNotifications(db);
    expect(all.map((n) => n.title)).toEqual(["second", "first"]);
    expect(all[0]!.linkPath).toBeNull(); // no entity -> no link

    await markNotificationRead(db, all[0]!.id);
    const unread = await listNotifications(db, { unreadOnly: true });
    expect(unread.map((n) => n.title)).toEqual(["first"]);
    expect(await countUnreadNotifications(db)).toBe(1);
  });

  it("computes entity link paths", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await notifyOwnersEvent(
      { type: "invoice_paid", title: "paid", body: "p", entityType: "invoice", entityId: "inv-9" },
      db,
    );
    const [item] = await listNotifications(db);
    expect(item!.linkPath).toBe("/admin/invoices/inv-9");
  });

  it("markNotificationRead is idempotent and false for unknown ids", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await notifyOwnersEvent({ type: "invoice_sent", title: "t", body: "b" }, db);
    const [item] = await listNotifications(db);
    expect(await markNotificationRead(db, item!.id)).toBe(true);
    expect(await markNotificationRead(db, item!.id)).toBe(true); // already read: still ok
    expect(await markNotificationRead(db, "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await countUnreadNotifications(db)).toBe(0);
  });

  it("markAllNotificationsRead marks everything and returns the count", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    await notifyOwnersEvent({ type: "invoice_sent", title: "a", body: "b" }, db);
    await notifyOwnersEvent({ type: "invoice_paid", title: "c", body: "d" }, db);
    expect(await markAllNotificationsRead(db)).toBe(2);
    expect(await markAllNotificationsRead(db)).toBe(0);
    expect(await countUnreadNotifications(db)).toBe(0);
  });
});

describe("notificationLinkPath", () => {
  it("maps each entity type to its admin detail page", () => {
    expect(notificationLinkPath("application", "a1")).toBe("/admin/applications/a1");
    expect(notificationLinkPath("order_request", "o1")).toBe("/admin/order-requests/o1");
    expect(notificationLinkPath("allocation_round", "r1")).toBe("/admin/allocation-rounds/r1");
    expect(notificationLinkPath("invoice", "i1")).toBe("/admin/invoices/i1");
    expect(notificationLinkPath(null, "i1")).toBeNull();
    expect(notificationLinkPath("invoice", null)).toBeNull();
  });
});

describe("event-site integration", () => {
  it("sendInvoice emits an invoice_sent notification linked to the invoice", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db, "george@example.com");
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, ownerId, "draft");

    await sendInvoice(db, inv.id);

    const rows = await db.select().from(notification).where(eq(notification.type, "invoice_sent"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe("invoice");
    expect(rows[0]!.entityId).toBe(inv.id);
    expect(rows[0]!.title).toContain(inv.invoiceNumber);
  });

  it("markShipmentShipped emits a shipment_shipped notification", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db, "george@example.com");
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, ownerId, "sent");
    await recordInvoicePayment(db, inv.id, ownerId, { amountMinor: 100000, method: "card" });
    const ship = await createShipment(db, inv.id, ownerId, {
      carrier: "UPS",
      trackingNumber: "1Z999",
    });

    await markShipmentShipped(db, ship.id, ownerId);

    const rows = await db.select().from(notification).where(eq(notification.type, "shipment_shipped"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(inv.id);
    expect(rows[0]!.body).toContain("1Z999");
  });

  it("a failed Stripe payment emits a warning payment_failed notification (no payment recorded)", async () => {
    const { db } = await createTestDb();
    await seedOwner(db, "george@example.com");
    const accountId = await seedAccount(db);
    const ownerId = await seedOwner(db, "joe@example.com");
    const inv = await seedInvoice(db, accountId, ownerId, "sent");

    const raw = JSON.stringify({
      id: "evt_test_fail",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_test_fail",
          amount: 100000,
          metadata: { invoiceId: inv.id },
          last_payment_error: { message: "Your card was declined." },
        },
      },
    });
    const result = await processStripeWebhook(db, raw, null);
    expect(result.handled).toBe(true);

    const rows = await db.select().from(notification).where(eq(notification.type, "payment_failed"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("warning");
    expect(rows[0]!.body).toContain("Your card was declined.");

    const [updated] = await db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(updated!.status).toBe("sent"); // still unpaid
  });
});

describe("migration 0022", () => {
  it("creates the notification table with the expected columns", async () => {
    const { client } = await createTestDb();
    const res = await client.query(
      `select column_name from information_schema.columns where table_name = 'notification' order by ordinal_position`,
    );
    const cols = (res as unknown as { rows: { column_name: string }[] }).rows.map((r) => r.column_name);
    expect(cols).toEqual([
      "id",
      "type",
      "title",
      "body",
      "actor_email",
      "entity_type",
      "entity_id",
      "severity",
      "read_at",
      "created_at",
    ]);
  });
});
