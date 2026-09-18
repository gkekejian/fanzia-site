import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, accountContact, auditLog, orderRequest, user } from "@/db/schema";
import {
  MAX_SILENT_ROLLOVERS,
  OFFER_EXPIRY_HOURS,
  canAutoRollover,
  rolloverExpiry,
} from "@/lib/invoicing/rules";
import {
  AlreadyDecidedError,
  InvoicingError,
  ViewerForbiddenError,
  approveOrderRequest,
  cancelOrderRequest,
  declineOrderRequest,
  processExpiredOffer,
  processExpiredOffers,
  reacceptExpiredOffer,
  type BuyerIdentity,
} from "@/lib/invoicing/service";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

async function seedOwner(db: TestDb) {
  const [u] = await db
    .insert(user)
    .values({ email: "owner@example.com", name: "Owner", role: "owner" })
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
      // unique per account: primaryContactEmail has a unique constraint
      primaryContactEmail: `pat-${Math.random().toString(36).slice(2, 10)}@testbuyer.example`,
    })
    .returning({ id: account.id });
  return acct!.id;
}

async function seedContact(db: TestDb, accountId: string, role: string): Promise<BuyerIdentity> {
  const [c] = await db
    .insert(accountContact)
    .values({ accountId, name: "Pat Buyer", email: `pat-${role}@testbuyer.example`, roleOnAccount: role })
    .returning();
  return {
    accountContactId: c!.id,
    accountId,
    contactName: c!.name,
    contactEmail: c!.email,
    contactRole: role,
  };
}

async function insertOrderRequest(
  db: TestDb,
  accountId: string,
  contactId: string,
  overrides: Partial<{
    status: string;
    expiresAt: Date;
    rolloverCount: number;
    subtotalMinor: number;
  }> = {},
) {
  const [row] = await db
    .insert(orderRequest)
    .values({
      accountId,
      contactId,
      lines: [],
      subtotalMinor: overrides.subtotalMinor ?? 60000,
      smallOrderFeeMinor: 0,
      status: overrides.status ?? "submitted",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000),
      rolloverCount: overrides.rolloverCount ?? 0,
    })
    .returning();
  return row!;
}

async function getRequest(db: TestDb, id: string) {
  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, id));
  return row!;
}

async function auditEntries(db: TestDb, action: string, entityId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)));
}

const pastExpiry = () => new Date(Date.now() - 60 * 1000);

describe("rollover rules (pure)", () => {
  it("caps silent rollovers at exactly one", () => {
    expect(MAX_SILENT_ROLLOVERS).toBe(1);
    expect(canAutoRollover(0)).toBe(true);
    expect(canAutoRollover(1)).toBe(false);
    expect(canAutoRollover(2)).toBe(false);
    expect(canAutoRollover(99)).toBe(false);
  });

  it("extends the expiry a full 48 hours from the rollover moment", () => {
    const from = new Date("2026-09-18T12:00:00Z");
    expect(rolloverExpiry(from).getTime()).toBe(from.getTime() + 48 * 3600 * 1000);
  });
});

describe("processExpiredOffer — first expiry auto-rollover", () => {
  it("extends the offer 48h, increments the count, and audit-logs actor=system", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { expiresAt: pastExpiry() });

    const before = Date.now();
    const { action, request } = await processExpiredOffer(db, req.id);

    expect(action).toBe("rolled_over");
    expect(request.status).toBe("submitted");
    expect(request.rolloverCount).toBe(1);
    expect(request.lastRolledOverAt).not.toBeNull();
    const extendedMs = new Date(request.expiresAt).getTime() - before;
    expect(extendedMs).toBeGreaterThan(47.9 * 3600 * 1000);
    expect(extendedMs).toBeLessThan(48.1 * 3600 * 1000);

    const entries = await auditEntries(db, "order_request.auto_rolled_over", req.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorType).toBe("system");
    expect((entries[0]!.before as { rolloverCount: number }).rolloverCount).toBe(0);
    expect((entries[0]!.after as { rolloverCount: number }).rolloverCount).toBe(1);
  });

  it("does nothing to a live offer (no expiry yet)", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId);

    const { action, request } = await processExpiredOffer(db, req.id);
    expect(action).toBe("none");
    expect(request.rolloverCount).toBe(0);
    const entries = await auditEntries(db, "order_request.auto_rolled_over", req.id);
    expect(entries).toHaveLength(0);
  });

  it("does nothing to an already-decided offer", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      status: "declined",
      expiresAt: pastExpiry(),
    });

    const { action } = await processExpiredOffer(db, req.id);
    expect(action).toBe("none");
    expect((await getRequest(db, req.id)).status).toBe("declined");
  });
});

describe("processExpiredOffer — second expiry requires reacceptance (no silent rollover)", () => {
  it("marks the offer expired WITHOUT extending it when the budget is spent", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const expiredAt = pastExpiry();
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      expiresAt: expiredAt,
      rolloverCount: 1,
    });

    const { action, request } = await processExpiredOffer(db, req.id);

    expect(action).toBe("expired");
    expect(request.status).toBe("expired");
    // hard cap: expiry untouched, count untouched
    expect(new Date(request.expiresAt).getTime()).toBe(expiredAt.getTime());
    expect(request.rolloverCount).toBe(1);
    expect(request.lastRolledOverAt).toBeNull();

    const entries = await auditEntries(db, "order_request.expired", req.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorType).toBe("system");
    const rolloverEntries = await auditEntries(db, "order_request.auto_rolled_over", req.id);
    expect(rolloverEntries).toHaveLength(0);
  });

  it("never rolls over more than once even if the count is already above the cap", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      expiresAt: pastExpiry(),
      rolloverCount: 5, // corrupted/high count — the cap still holds
    });

    const { action, request } = await processExpiredOffer(db, req.id);
    expect(action).toBe("expired");
    expect(request.status).toBe("expired");
    expect(request.rolloverCount).toBe(5);
  });
});

describe("processExpiredOffers sweep", () => {
  it("rolls over first-expiry offers and expires second-expiry ones in one pass", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const first = await insertOrderRequest(db, accountId, buyer.accountContactId, { expiresAt: pastExpiry() });
    const second = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      expiresAt: pastExpiry(),
      rolloverCount: 1,
    });
    const live = await insertOrderRequest(db, accountId, buyer.accountContactId); // not expired

    const { rolledOver, expired } = await processExpiredOffers(db);

    expect(rolledOver).toEqual([first.id]);
    expect(expired).toEqual([second.id]);
    expect((await getRequest(db, first.id)).status).toBe("submitted");
    expect((await getRequest(db, first.id)).rolloverCount).toBe(1);
    expect((await getRequest(db, second.id)).status).toBe("expired");
    expect((await getRequest(db, live.id)).status).toBe("submitted");
  });
});

describe("reacceptExpiredOffer — explicit buyer reacceptance", () => {
  async function expiredOffer(db: TestDb) {
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      status: "expired",
      expiresAt: pastExpiry(),
      rolloverCount: 1,
      subtotalMinor: 80000,
    });
    return { accountId, buyer, req };
  }

  it("creates a fresh offer version with the same terms and marks the old one superseded", async () => {
    const { db } = await createTestDb();
    const { buyer, req } = await expiredOffer(db);

    const before = Date.now();
    const fresh = await reacceptExpiredOffer(db, req.id, buyer);

    expect(fresh.id).not.toBe(req.id);
    expect(fresh.status).toBe("submitted");
    expect(fresh.subtotalMinor).toBe(80000);
    expect(fresh.rolloverCount).toBe(0); // fresh budget for the new version
    expect(fresh.supersedesId).toBe(req.id);
    const extendedMs = new Date(fresh.expiresAt).getTime() - before;
    expect(extendedMs).toBeGreaterThan(47.9 * 3600 * 1000);
    expect(extendedMs).toBeLessThan(48.1 * 3600 * 1000);

    const old = await getRequest(db, req.id);
    expect(old.status).toBe("superseded");

    const entries = await auditEntries(db, "order_request.reaccepted", req.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorType).toBe("buyer");
    expect((entries[0]!.after as { newOrderRequestId: string }).newOrderRequestId).toBe(fresh.id);
  });

  it("refuses a view-only contact — reacceptance is an explicit ordering action", async () => {
    const { db } = await createTestDb();
    const { accountId, req } = await expiredOffer(db);
    const viewer = await seedContact(db, accountId, "viewer");
    await expect(reacceptExpiredOffer(db, req.id, viewer)).rejects.toBeInstanceOf(ViewerForbiddenError);
  });

  it("refuses a buyer from another account (404, no cross-account leak)", async () => {
    const { db } = await createTestDb();
    const { req } = await expiredOffer(db);
    const otherAccountId = await seedAccount(db);
    const other = await seedContact(db, otherAccountId, "purchaser");
    await expect(reacceptExpiredOffer(db, req.id, other)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses reacceptance of a live offer — only expired offers qualify", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId);
    await expect(reacceptExpiredOffer(db, req.id, buyer)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses when the rollover budget was not spent (inconsistent state, never implied)", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      status: "expired",
      expiresAt: pastExpiry(),
      rolloverCount: 0, // should have been rolled over, not expired
    });
    await expect(reacceptExpiredOffer(db, req.id, buyer)).rejects.toMatchObject({ status: 409 });
    expect((await getRequest(db, req.id)).status).toBe("expired");
  });

  it("cannot reaccept twice — the superseded offer is terminal", async () => {
    const { db } = await createTestDb();
    const { buyer, req } = await expiredOffer(db);
    await reacceptExpiredOffer(db, req.id, buyer);
    await expect(reacceptExpiredOffer(db, req.id, buyer)).rejects.toBeInstanceOf(InvoicingError);
  });
});

describe("cancelOrderRequest — cancel-and-refund path", () => {
  it("lets the buyer cancel an expired offer; audit shows no payment taken and no refund due", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      status: "expired",
      expiresAt: pastExpiry(),
      rolloverCount: 1,
    });

    const cancelled = await cancelOrderRequest(db, req.id, { type: "buyer", buyer }, { reason: "changed my mind" });
    expect(cancelled.status).toBe("cancelled");

    const entries = await auditEntries(db, "order_request.cancelled", req.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorType).toBe("buyer");
    const after = entries[0]!.after as { paymentTaken: boolean; refundDueMinor: number; reason: string };
    expect(after.paymentTaken).toBe(false);
    expect(after.refundDueMinor).toBe(0);
    expect(after.reason).toBe("changed my mind");
  });

  it("lets an owner cancel a live submitted offer", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId);

    const cancelled = await cancelOrderRequest(db, req.id, { type: "owner", ownerId });
    expect(cancelled.status).toBe("cancelled");
    const entries = await auditEntries(db, "order_request.cancelled", req.id);
    expect(entries[0]!.actorType).toBe("owner");
    expect(entries[0]!.actorUserId).toBe(ownerId);
  });

  it("refuses to cancel an already-decided offer (cancel is terminal)", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { status: "declined" });
    await expect(cancelOrderRequest(db, req.id, { type: "buyer", buyer })).rejects.toBeInstanceOf(
      AlreadyDecidedError,
    );
  });

  it("refuses buyer cancel from another account", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { status: "expired", rolloverCount: 1 });
    const otherAccountId = await seedAccount(db);
    const other = await seedContact(db, otherAccountId, "purchaser");
    await expect(cancelOrderRequest(db, req.id, { type: "buyer", buyer: other })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("decisions under the rollover policy", () => {
  it("declining a first-expiry stale request rolls it over, then declines", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { expiresAt: pastExpiry() });

    const declined = await declineOrderRequest(db, req.id, ownerId, "out of stock");
    expect(declined.status).toBe("declined");
    const row = await getRequest(db, req.id);
    expect(row.rolloverCount).toBe(1); // the silent rollover was consumed by the policy pass
  });

  it("approving a superseded offer is rejected as already decided", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      status: "superseded",
      expiresAt: pastExpiry(),
      rolloverCount: 1,
    });
    await expect(approveOrderRequest(db, req.id, ownerId)).rejects.toBeInstanceOf(AlreadyDecidedError);
  });
});
