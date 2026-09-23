import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, accountContact, invoice, orderRequest } from "@/db/schema";
import { setSetting, SETTINGS_KEYS } from "@/lib/settings";

vi.mock("@/lib/notifications", () => ({ notifyOwnersEvent: vi.fn(async () => {}), notifyOwners: vi.fn(async () => {}) }));

import { autoApproveIfEligible } from "@/lib/invoicing/autoApprove";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
let db: TestDb;

beforeEach(async () => {
  ({ db } = await createTestDb());
});

async function seed(opts: { taxStatus?: "pending" | "exempt"; paidInvoices?: number; openInvoices?: number; totalMinor?: number }) {
  const [acct] = await db
    .insert(account)
    .values({
      legalName: "Repeat Buyer LLC",
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Pat",
      primaryContactEmail: "pat@buyer.example",
      taxStatus: opts.taxStatus ?? "exempt",
    })
    .returning();
  const [contact] = await db
    .insert(accountContact)
    .values({ accountId: acct!.id, name: "Pat", email: "pat@buyer.example", roleOnAccount: "purchaser" })
    .returning();
  const mk = (status: string, i: number) => ({
    invoiceNumber: `FZ-T-${status}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    accountId: acct!.id,
    lines: [],
    subtotalMinor: 60000,
    smallOrderFeeMinor: 0,
    taxMinor: 0,
    totalMinor: 60000,
    status,
  });
  for (let i = 0; i < (opts.paidInvoices ?? 1); i++) await db.insert(invoice).values(mk("paid", i));
  for (let i = 0; i < (opts.openInvoices ?? 0); i++) await db.insert(invoice).values(mk("sent", i));
  const total = opts.totalMinor ?? 100000;
  const [req] = await db
    .insert(orderRequest)
    .values({
      accountId: acct!.id,
      contactId: contact!.id,
      lines: [],
      subtotalMinor: total,
      smallOrderFeeMinor: 0,
      expiresAt: new Date(Date.now() + 48 * 3600_000),
    })
    .returning();
  return req!.id;
}

describe("autoApproveIfEligible", () => {
  it("is off by default: nothing is approved without an owner-set ceiling", async () => {
    const id = await seed({});
    expect(await autoApproveIfEligible(db, id)).toMatchObject({ approved: false, reason: "auto-approval disabled" });
  });

  it("approves AND sends the invoice for a repeat, tax-exempt buyer under the ceiling", async () => {
    await setSetting(SETTINGS_KEYS.orderAutoApproveMaxMinor, 250000, "test", db);
    const id = await seed({});
    const result = await autoApproveIfEligible(db, id);
    expect(result.approved).toBe(true);
    const [inv] = await db.select().from(invoice).where(eq(invoice.orderRequestId, id));
    expect(inv!.status).toBe("sent");
    const [req] = await db.select().from(orderRequest).where(eq(orderRequest.id, id));
    expect(req!.status).toBe("invoiced");
  });

  it.each([
    ["first order", { paidInvoices: 0 }, "first order"],
    ["unverified tax status", { taxStatus: "pending" as const }, "tax status"],
    ["unpaid invoice outstanding", { openInvoices: 1 }, "unpaid invoice"],
    ["over the ceiling", { totalMinor: 300000 }, "ceiling"],
  ])("leaves %s for manual review", async (_label, opts, reason) => {
    await setSetting(SETTINGS_KEYS.orderAutoApproveMaxMinor, 250000, "test", db);
    const id = await seed(opts);
    const result = await autoApproveIfEligible(db, id);
    expect(result.approved).toBe(false);
    expect((result as { reason: string }).reason).toContain(reason);
    const [req] = await db.select().from(orderRequest).where(eq(orderRequest.id, id));
    expect(req!.status).toBe("submitted");
  });
});
