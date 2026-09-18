import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  account,
  accountContact,
  currency,
  draftRequest,
  invoice,
  orderRequest,
  priceEpoch,
  product,
  user,
} from "@/db/schema";
import { saveDraftRequest } from "@/lib/catalog/draftRequest";
import {
  ORDER_MINIMUM_MINOR,
  SMALL_ORDER_FEE_MINOR,
  FIRST_ORDER_CAP_MINOR,
  computeSmallOrderFee,
  meetsMinimum,
  firstOrderCapApplies,
  isExpired,
  computeFundsClearedAt,
  addBusinessDays,
  invoiceCleared,
  balanceDue,
} from "@/lib/invoicing/rules";
import { nextInvoiceNumber } from "@/lib/invoicing/sequences";
import {
  submitDraftRequest,
  approveOrderRequest,
  declineOrderRequest,
  recordInvoicePayment,
  confirmWirePayment,
  sendInvoice,
  voidInvoice,
  setInvoiceTax,
  ViewerForbiddenError,
  EmptyDraftError,
  BelowMinimumError,
  UnpricedLineError,
  ExpiredError,
  FirstOrderCapError,
  BalanceExceededError,
  AlreadyDecidedError,
  InvoicingError,
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
      primaryContactEmail: "pat@testbuyer.example",
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

/** One priced, visible product; returns its id and unit price (minor). */
async function seedPricedProduct(db: TestDb, priceMinor: number) {
  await db
    .insert(currency)
    .values({ code: "USD", exponent: 2, name: "US Dollar" })
    .onConflictDoNothing();
  const [p] = await db
    .insert(product)
    .values({
      sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: "Test Booster Box",
      editionLanguage: "English",
      origin: "import",
      condition: "sealed",
      packsPerUnit: 24,
      releaseStatus: "released",
      descriptionOriginal: "Test product",
      status: "active",
      publiclyVisible: true,
    })
    .returning({ id: product.id });
  await db.insert(priceEpoch).values({
    productId: p!.id,
    currencyCode: "USD",
    costMinor: Math.round(priceMinor / 1.35),
    markupBps: 3500,
    priceMinor,
    realizedGrossMarginBps: 2500,
  });
  return { productId: p!.id, priceMinor };
}

async function insertOrderRequest(
  db: TestDb,
  accountId: string,
  contactId: string,
  overrides: Partial<{ subtotalMinor: number; status: string; expiresAt: Date }> = {},
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
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
    })
    .returning();
  return row!;
}

async function insertInvoice(db: TestDb, accountId: string, totalMinor: number, ownerId: string, status = "draft") {
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
      createdBy: ownerId,
    })
    .returning();
  return row!;
}

describe("order minimum / small-order fee / first-order cap", () => {
  it("charges the $25 fee only under $750", () => {
    expect(computeSmallOrderFee(74999)).toBe(SMALL_ORDER_FEE_MINOR);
    expect(computeSmallOrderFee(75000)).toBe(0);
    expect(computeSmallOrderFee(0)).toBe(SMALL_ORDER_FEE_MINOR);
  });

  it("enforces the $500 minimum on the subtotal", () => {
    expect(meetsMinimum(ORDER_MINIMUM_MINOR)).toBe(true);
    expect(meetsMinimum(ORDER_MINIMUM_MINOR - 1)).toBe(false);
  });

  it("applies the first-order cap only when no prior non-void invoices exist", () => {
    expect(firstOrderCapApplies(0)).toBe(true);
    expect(firstOrderCapApplies(1)).toBe(false);
    expect(FIRST_ORDER_CAP_MINOR).toBe(500000);
  });

  it("treats offers as expired at exactly 48h", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    expect(isExpired(new Date("2026-09-18T11:59:59Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-09-18T12:00:01Z"), now)).toBe(false);
  });
});

describe("funds-cleared computation", () => {
  const friday = new Date("2026-09-18T12:00:00Z"); // a Friday

  it("card clears immediately", () => {
    expect(computeFundsClearedAt("card", friday, 0)!.getTime()).toBe(friday.getTime());
  });

  it("wire never clears at record time", () => {
    expect(computeFundsClearedAt("wire", friday, 99)).toBeNull();
  });

  it("ACH: +5 business days for the first three payments (skips the weekend)", () => {
    // Fri 9/18 + 5 business days = Fri 9/25
    expect(computeFundsClearedAt("ach", friday, 0)!.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(computeFundsClearedAt("ach", friday, 2)!.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("ACH: +2 business days once the account has three prior payments", () => {
    // Fri 9/18 + 2 business days = Tue 9/22
    expect(computeFundsClearedAt("ach", friday, 3)!.toISOString()).toBe("2026-09-22T12:00:00.000Z");
    expect(computeFundsClearedAt("ach", friday, 10)!.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });

  it("addBusinessDays skips weekends", () => {
    expect(addBusinessDays(friday, 1).toISOString()).toBe("2026-09-21T12:00:00.000Z"); // Monday
  });
});

describe("invoiceCleared", () => {
  const total = 100000;
  it("counts only payments whose funds cleared at or before now", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const payments = [
      { amountMinor: 60000, fundsClearedAt: new Date("2026-09-17T12:00:00Z") },
      { amountMinor: 40000, fundsClearedAt: null }, // wire, unconfirmed
      { amountMinor: 40000, fundsClearedAt: new Date("2026-09-20T12:00:00Z") }, // clears in the future
    ];
    expect(invoiceCleared(total, payments, now)).toBe(false);
    expect(
      invoiceCleared(total, [...payments, { amountMinor: 40000, fundsClearedAt: new Date("2026-09-10T12:00:00Z") }], now),
    ).toBe(true);
  });
});

describe("nextInvoiceNumber", () => {
  it("issues sequential FZ- numbers", async () => {
    const { db } = await createTestDb();
    expect(await nextInvoiceNumber(db)).toBe("FZ-000001");
    expect(await nextInvoiceNumber(db)).toBe("FZ-000002");
  });
});

describe("submitDraftRequest", () => {
  it("rejects viewers with 403", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "viewer");
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(ViewerForbiddenError);
  });

  it("rejects empty drafts", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(EmptyDraftError);
  });

  it("rejects sub-minimum orders", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const { productId } = await seedPricedProduct(db, 10000); // $100/unit
    await saveDraftRequest(accountId, { lines: [{ productId, qtyRequested: 4 }], notes: "" }, db); // $400
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(BelowMinimumError);
  });

  it("rejects draft lines with no current price", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    await saveDraftRequest(
      accountId,
      { lines: [{ productId: "00000000-0000-0000-0000-000000000000", qtyRequested: 10 }], notes: "" },
      db,
    );
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(UnpricedLineError);
  });

  it("creates the request with snapshot prices, fee, 48h expiry, and clears the draft", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const { productId } = await seedPricedProduct(db, 10000); // $100/unit x6 = $600
    await saveDraftRequest(accountId, { lines: [{ productId, qtyRequested: 6 }], notes: "rush" }, db);

    const before = Date.now();
    const created = await submitDraftRequest(db, buyer);

    expect(created.status).toBe("submitted");
    expect(created.subtotalMinor).toBe(60000);
    expect(created.smallOrderFeeMinor).toBe(SMALL_ORDER_FEE_MINOR); // under $750
    const lines = created.lines as { unitPriceMinor: number; lineTotalMinor: number }[];
    expect(lines[0]!.unitPriceMinor).toBe(10000);
    expect(lines[0]!.lineTotalMinor).toBe(60000);
    const expiryMs = new Date(created.expiresAt).getTime() - before;
    expect(expiryMs).toBeGreaterThan(47.9 * 3600 * 1000);
    expect(expiryMs).toBeLessThan(48.1 * 3600 * 1000);
    // draft cleared
    const [draft] = await db.select().from(draftRequest).where(eq(draftRequest.accountId, accountId));
    expect(draft).toBeUndefined();
  });
});

describe("approveOrderRequest / declineOrderRequest", () => {
  it("auto-rolls over once on first expiry, then approval proceeds against the renewed offer", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const { request, invoice: inv } = await approveOrderRequest(db, req.id, ownerId);
    expect(request.status).toBe("invoiced");
    expect(inv.status).toBe("draft");
    const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, req.id));
    expect(row!.rolloverCount).toBe(1);
    expect(row!.lastRolledOverAt).not.toBeNull();
  });

  it("rejects approval on second expiry (rollover budget spent) and marks the offer expired", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const expiredAt = new Date(Date.now() - 1000);
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { expiresAt: expiredAt });
    await db.update(orderRequest).set({ rolloverCount: 1 }).where(eq(orderRequest.id, req.id));
    await expect(approveOrderRequest(db, req.id, ownerId)).rejects.toBeInstanceOf(ExpiredError);
    const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, req.id));
    expect(row!.status).toBe("expired");
    // no second silent rollover: the expiry was NOT extended
    expect(new Date(row!.expiresAt).getTime()).toBe(expiredAt.getTime());
    expect(row!.rolloverCount).toBe(1);
  });

  it("enforces the $5,000 first-order cap", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { subtotalMinor: 600000 });
    await expect(approveOrderRequest(db, req.id, ownerId)).rejects.toBeInstanceOf(FirstOrderCapError);
  });

  it("approves under the cap, creating a numbered draft invoice and marking the request invoiced", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId, { subtotalMinor: 60000 });
    const { request, invoice: inv } = await approveOrderRequest(db, req.id, ownerId);
    expect(request.status).toBe("invoiced");
    expect(inv.invoiceNumber).toBe("FZ-000001");
    expect(inv.status).toBe("draft");
    expect(inv.taxMinor).toBe(0);
    expect(inv.totalMinor).toBe(60000);
    await expect(approveOrderRequest(db, req.id, ownerId)).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it("requires a decline reason", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "primary");
    const req = await insertOrderRequest(db, accountId, buyer.accountContactId);
    await expect(declineOrderRequest(db, req.id, ownerId, "   ")).rejects.toBeInstanceOf(InvoicingError);
    const declined = await declineOrderRequest(db, req.id, ownerId, "Cannot verify reseller permit.");
    expect(declined.status).toBe("declined");
    expect(declined.declineReason).toBe("Cannot verify reseller permit.");
  });
});

describe("payments", () => {
  it("rejects payments over the remaining balance", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "sent");
    await expect(
      recordInvoicePayment(db, inv.id, ownerId, { amountMinor: 100001, method: "card" }),
    ).rejects.toBeInstanceOf(BalanceExceededError);
  });

  it("card payment in full clears immediately and marks the invoice paid", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "sent");
    const paidAt = new Date("2026-09-11T12:00:00Z");
    const { payment: pay, invoice: updated } = await recordInvoicePayment(db, inv.id, ownerId, {
      amountMinor: 100000,
      method: "card",
      paidAt,
    });
    expect(pay.fundsClearedAt!.getTime()).toBe(paidAt.getTime());
    expect(updated.status).toBe("paid");
  });

  it("partial ACH leaves the invoice partial with future clearing", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "sent");
    const paidAt = new Date("2026-09-11T12:00:00Z"); // Friday
    const { payment: pay, invoice: updated } = await recordInvoicePayment(db, inv.id, ownerId, {
      amountMinor: 40000,
      method: "ach",
      paidAt,
    });
    expect(updated.status).toBe("partial");
    expect(pay.fundsClearedAt!.toISOString()).toBe("2026-09-18T12:00:00.000Z"); // +5 business days
    expect(balanceDue(updated.totalMinor, [pay])).toBe(60000);
  });

  it("wire stays uncleared until the owner confirms receipt", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "sent");
    const { payment: pay, invoice: partial } = await recordInvoicePayment(db, inv.id, ownerId, {
      amountMinor: 100000,
      method: "wire",
      reference: "WIRE-123",
    });
    expect(pay.fundsClearedAt).toBeNull();
    expect(partial.status).toBe("partial"); // paid in full but not cleared
    const { payment: confirmed, invoice: paid } = await confirmWirePayment(db, pay.id);
    expect(confirmed.fundsClearedAt).not.toBeNull();
    expect(confirmed.wireConfirmedAt).not.toBeNull();
    expect(paid.status).toBe("paid");
  });

  it("refuses payments on void invoices and refuses to void invoices with payments", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 50000, ownerId, "sent");
    await recordInvoicePayment(db, inv.id, ownerId, { amountMinor: 10000, method: "card" });
    await expect(voidInvoice(db, inv.id)).rejects.toBeInstanceOf(InvoicingError);
    const clean = await insertInvoice(db, accountId, 50000, ownerId, "draft");
    const voided = await voidInvoice(db, clean.id);
    expect(voided.status).toBe("void");
    await expect(
      recordInvoicePayment(db, clean.id, ownerId, { amountMinor: 10000, method: "card" }),
    ).rejects.toBeInstanceOf(InvoicingError);
  });

  it("send moves draft to sent; tax adjusts only on drafts and recomputes the total", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 60000, ownerId, "draft");
    const taxed = await setInvoiceTax(db, inv.id, 5400);
    expect(taxed.taxMinor).toBe(5400);
    expect(taxed.totalMinor).toBe(65400);
    const sent = await sendInvoice(db, inv.id);
    expect(sent.status).toBe("sent");
    await expect(setInvoiceTax(db, inv.id, 100)).rejects.toBeInstanceOf(InvoicingError);
  });
});
