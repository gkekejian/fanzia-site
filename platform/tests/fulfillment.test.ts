import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  account,
  accountContact,
  currency,
  invoice,
  priceEpoch,
  product,
  shipment,
  sourcingRoute,
  supplier,
  user,
} from "@/db/schema";
import { saveDraftRequest } from "@/lib/catalog/draftRequest";
import { getMemberCatalog } from "@/lib/catalog/queries";
import {
  getInvoiceDetail,
  recordInvoicePayment,
  voidInvoice,
  submitDraftRequest,
  ImportAcknowledgmentRequiredError,
  type BuyerIdentity,
} from "@/lib/invoicing/service";
import {
  createShipment,
  markShipmentShipped,
  markShipmentDelivered,
  cancelShipment,
  ShipmentError,
} from "@/lib/invoicing/fulfillment";

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

async function seedPricedProduct(db: TestDb, priceMinor: number, routeType?: "import" | "domestic") {
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

  let sourcingRouteId: string | null = null;
  if (routeType) {
    const [sup] = await db
      .insert(supplier)
      .values({ name: "Test Supplier" })
      .returning({ id: supplier.id });
    const [route] = await db
      .insert(sourcingRoute)
      .values({
        productId: p!.id,
        supplierId: sup!.id,
        routeType,
        confidence: "quoted",
        sourceType: "member_page",
      })
      .returning({ id: sourcingRoute.id });
    sourcingRouteId = route!.id;
  }

  await db.insert(priceEpoch).values({
    productId: p!.id,
    sourcingRouteId,
    currencyCode: "USD",
    costMinor: Math.round(priceMinor / 1.35),
    markupBps: 3500,
    priceMinor,
    realizedGrossMarginBps: 2500,
  });
  return p!.id;
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

/** A sent invoice fully paid by card: cleared, paid, eligible for fulfillment. */
async function seedClearedInvoice(db: TestDb, ownerId: string, accountId: string, totalMinor = 100000) {
  const inv = await insertInvoice(db, accountId, totalMinor, ownerId, "sent");
  await recordInvoicePayment(db, inv.id, ownerId, { amountMinor: totalMinor, method: "card" });
  return inv;
}

describe("shipment lifecycle", () => {
  it("refuses shipments before cleared funds cover the invoice", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "sent");
    await expect(
      createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "1Z999" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses shipments on void invoices", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await insertInvoice(db, accountId, 100000, ownerId, "draft");
    await voidInvoice(db, inv.id);
    await expect(
      createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "1Z999" }),
    ).rejects.toBeInstanceOf(ShipmentError);
  });

  it("requires carrier and tracking number", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await seedClearedInvoice(db, ownerId, accountId);
    await expect(createShipment(db, inv.id, ownerId, { carrier: "", trackingNumber: "1Z999" })).rejects.toBeInstanceOf(
      ShipmentError,
    );
    await expect(createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "  " })).rejects.toBeInstanceOf(
      ShipmentError,
    );
  });

  it("creates a shipment once funds clear, then rejects a second active one", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await seedClearedInvoice(db, ownerId, accountId);

    const s = await createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "1Z999" });
    expect(s.status).toBe("preparing");
    expect(s.invoiceId).toBe(inv.id);

    await expect(
      createShipment(db, inv.id, ownerId, { carrier: "FedEx", trackingNumber: "999" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("walks preparing -> shipped -> delivered, rejecting invalid jumps", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await seedClearedInvoice(db, ownerId, accountId);
    const s = await createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "1Z999" });

    // deliver before ship: rejected
    await expect(markShipmentDelivered(db, s.id, ownerId)).rejects.toMatchObject({ status: 409 });

    const shipped = await markShipmentShipped(db, s.id, ownerId);
    expect(shipped.status).toBe("shipped");
    expect(shipped.shippedAt).not.toBeNull();

    // ship twice: rejected
    await expect(markShipmentShipped(db, s.id, ownerId)).rejects.toMatchObject({ status: 409 });
    // cancel after shipping: rejected
    await expect(cancelShipment(db, s.id, ownerId)).rejects.toMatchObject({ status: 409 });

    const delivered = await markShipmentDelivered(db, s.id, ownerId);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();

    // deliver twice: rejected
    await expect(markShipmentDelivered(db, s.id, ownerId)).rejects.toMatchObject({ status: 409 });
  });

  it("lets a canceled (pre-ship) shipment be replaced", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await seedClearedInvoice(db, ownerId, accountId);

    const s = await createShipment(db, inv.id, ownerId, { carrier: "FedEx", trackingNumber: "BAD" });
    const canceled = await cancelShipment(db, s.id, ownerId, "wrong address");
    expect(canceled.status).toBe("canceled");
    expect(canceled.cancelReason).toBe("wrong address");

    const replacement = await createShipment(db, inv.id, ownerId, { carrier: "UPS", trackingNumber: "1Z111" });
    expect(replacement.status).toBe("preparing");

    const rows = await db.select().from(shipment).where(eq(shipment.invoiceId, inv.id));
    expect(rows).toHaveLength(2);
  });

  it("returns 404 for unknown shipments", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    await expect(
      markShipmentShipped(db, "00000000-0000-0000-0000-000000000000", ownerId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("exposes shipments on the invoice detail", async () => {
    const { db } = await createTestDb();
    const ownerId = await seedOwner(db);
    const accountId = await seedAccount(db);
    const inv = await seedClearedInvoice(db, ownerId, accountId);
    await createShipment(db, inv.id, ownerId, { carrier: "USPS", trackingNumber: "9400" });

    const detail = await getInvoiceDetail(db, inv.id);
    expect(detail.readyForFulfillment).toBe(true);
    expect(detail.shipments).toHaveLength(1);
    expect(detail.shipments[0]!.trackingNumber).toBe("9400");
  });
});

describe("import clickwrap on order submit", () => {
  it("flags import-route products in the member catalog", async () => {
    const { db } = await createTestDb();
    const importId = await seedPricedProduct(db, 10000, "import");
    const catalog = await getMemberCatalog(db);
    const item = catalog.find((p) => p.id === importId)!;
    expect(item.requiresImportAcknowledgment).toBe(true);
  });

  it("requires acknowledgment when the draft includes imported product", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const productId = await seedPricedProduct(db, 10000, "import"); // $100/unit x6 = $600
    await saveDraftRequest(accountId, { lines: [{ productId, qtyRequested: 6 }], notes: "" }, db);

    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(ImportAcknowledgmentRequiredError);
    await expect(submitDraftRequest(db, buyer, { importAcknowledged: false })).rejects.toBeInstanceOf(
      ImportAcknowledgmentRequiredError,
    );

    const created = await submitDraftRequest(db, buyer, { importAcknowledged: true });
    expect(created.status).toBe("submitted");
  });

  it("does not require acknowledgment for products without an import route", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const buyer = await seedContact(db, accountId, "purchaser");
    const productId = await seedPricedProduct(db, 10000, "domestic"); // $100/unit x6 = $600
    await saveDraftRequest(accountId, { lines: [{ productId, qtyRequested: 6 }], notes: "" }, db);

    const created = await submitDraftRequest(db, buyer);
    expect(created.status).toBe("submitted");
  });
});
