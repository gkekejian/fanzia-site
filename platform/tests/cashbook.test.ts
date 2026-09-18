import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, cashbookEntry, invoice, payment } from "@/db/schema";
import {
  totalsByDirection,
  runningBalance,
  validateManualEntry,
  summarizeReceivables,
  postPaymentsToCashbook,
} from "@/lib/accounting/cashbook";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

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

async function seedInvoice(db: TestDb, accountId: string, totalMinor: number, status = "sent") {
  const [row] = await db
    .insert(invoice)
    .values({
      invoiceNumber: `FZ-CB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      accountId,
      lines: [],
      subtotalMinor: totalMinor,
      totalMinor,
      status,
      sentAt: new Date("2026-09-01T12:00:00Z"),
    })
    .returning();
  return row!;
}

async function seedPayment(
  db: TestDb,
  invoiceId: string,
  accountId: string,
  amountMinor: number,
  fundsClearedAt: Date | null,
) {
  const [row] = await db
    .insert(payment)
    .values({
      invoiceId,
      accountId,
      amountMinor,
      method: "card",
      paidAt: new Date("2026-09-10T12:00:00Z"),
      fundsClearedAt,
    })
    .returning();
  return row!;
}

describe("totalsByDirection", () => {
  it("sums in/out and computes the balance", () => {
    const totals = totalsByDirection([
      { direction: "in", amountMinor: 10000 },
      { direction: "in", amountMinor: 5000 },
      { direction: "out", amountMinor: 3000 },
    ]);
    expect(totals).toEqual({ inMinor: 15000, outMinor: 3000, balanceMinor: 12000 });
  });

  it("handles an empty ledger", () => {
    expect(totalsByDirection([])).toEqual({ inMinor: 0, outMinor: 0, balanceMinor: 0 });
  });
});

describe("runningBalance", () => {
  it("accumulates chronologically regardless of input order", () => {
    const rows = [
      { id: "c", entryDate: "2026-09-03", direction: "out", amountMinor: 200, createdAt: new Date("2026-09-03T10:00:00Z") },
      { id: "a", entryDate: "2026-09-01", direction: "in", amountMinor: 1000, createdAt: new Date("2026-09-01T10:00:00Z") },
      { id: "b", entryDate: "2026-09-02", direction: "in", amountMinor: 500, createdAt: new Date("2026-09-02T10:00:00Z") },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[];
    const result = runningBalance(rows);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.map((r) => r.runningBalanceMinor)).toEqual([1000, 1500, 1300]);
  });
});

describe("validateManualEntry", () => {
  const valid = { entryDate: "2026-09-18", direction: "out", amountMinor: 2500, category: "expense" };

  it("accepts a well-formed entry", () => {
    expect(validateManualEntry(valid)).toBeNull();
  });

  it("rejects zero, negative, and fractional amounts", () => {
    expect(validateManualEntry({ ...valid, amountMinor: 0 })).toMatch(/positive/);
    expect(validateManualEntry({ ...valid, amountMinor: -100 })).toMatch(/positive/);
    expect(validateManualEntry({ ...valid, amountMinor: 10.5 })).toMatch(/positive/);
  });

  it("rejects bad dates, directions, and categories", () => {
    expect(validateManualEntry({ ...valid, entryDate: "09/18/2026" })).toMatch(/YYYY-MM-DD/);
    expect(validateManualEntry({ ...valid, direction: "sideways" })).toMatch(/direction/);
    expect(validateManualEntry({ ...valid, category: "crypto" })).toMatch(/category/);
  });
});

describe("summarizeReceivables", () => {
  it("sums remaining balances, skips fully paid, counts overdue", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const result = summarizeReceivables(
      [
        { totalMinor: 10000, paidMinor: 4000, sentAt: new Date("2026-09-10T12:00:00Z") }, // 6000, recent
        { totalMinor: 5000, paidMinor: 5000, sentAt: new Date("2026-08-01T12:00:00Z") }, // fully paid → skipped
        { totalMinor: 8000, paidMinor: 0, sentAt: new Date("2026-07-01T12:00:00Z") }, // 8000, overdue
        { totalMinor: 2000, paidMinor: 0, sentAt: null }, // 2000, no sent date → not overdue
      ],
      now,
    );
    expect(result.receivablesMinor).toBe(16000);
    expect(result.overdueCount).toBe(1);
    expect(result.count).toBe(3);
  });
});

describe("postPaymentsToCashbook", () => {
  it("posts cleared payments and is idempotent across runs", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 10000);
    const cleared = new Date("2026-09-10T12:00:00Z");
    await seedPayment(db, inv.id, accountId, 10000, cleared);

    const first = await postPaymentsToCashbook(db);
    expect(first).toBe(1);

    const entries = await db.select().from(cashbookEntry);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe("in");
    expect(entries[0]!.amountMinor).toBe(10000);
    expect(entries[0]!.category).toBe("invoice_payment");
    expect(entries[0]!.referenceType).toBe("payment");
    expect(entries[0]!.entryDate).toBe("2026-09-10");

    const second = await postPaymentsToCashbook(db);
    expect(second).toBe(0);
    expect((await db.select().from(cashbookEntry))).toHaveLength(1);
  });

  it("skips payments whose funds have not cleared", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 5000);
    await seedPayment(db, inv.id, accountId, 5000, null); // uncleared wire

    expect(await postPaymentsToCashbook(db)).toBe(0);
    expect((await db.select().from(cashbookEntry))).toHaveLength(0);
  });

  it("posts only newly cleared payments on a later run", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const inv = await seedInvoice(db, accountId, 6000);
    const p1 = await seedPayment(db, inv.id, accountId, 3000, new Date("2026-09-10T12:00:00Z"));
    const p2 = await seedPayment(db, inv.id, accountId, 3000, null);

    expect(await postPaymentsToCashbook(db)).toBe(1);

    // The second payment clears later.
    await db.update(payment).set({ fundsClearedAt: new Date("2026-09-12T12:00:00Z") }).where(eq(payment.id, p2.id));
    expect(await postPaymentsToCashbook(db)).toBe(1);
    expect((await db.select().from(cashbookEntry))).toHaveLength(2);
    expect(p1.id).not.toBe(p2.id);
  });
});
