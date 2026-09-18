import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, ne } from "drizzle-orm";
import { account, invoice, shipment } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { sendNotificationEmail } from "@/lib/email/send";
import { getInvoiceDetail, InvoicingError } from "./service";

export { InvoicingError };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class ShipmentError extends InvoicingError {}

export type ShipmentInput = {
  carrier: string;
  trackingNumber: string;
  notes?: string;
};

type ShipmentRow = typeof shipment.$inferSelect;

async function getShipment(db: AnyDb, shipmentId: string): Promise<ShipmentRow> {
  const [row] = await db.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
  if (!row) throw new ShipmentError("Shipment not found.", 404);
  return row;
}

function clean(str: string | undefined, max: number): string {
  const trimmed = (str ?? "").trim();
  if (!trimmed) throw new ShipmentError("Carrier and tracking number are required.", 400);
  if (trimmed.length > max) throw new ShipmentError(`Value is too long (max ${max} characters).`, 400);
  return trimmed;
}

/** Shipments for an invoice, newest first. */
export async function listShipmentsForInvoice(db: AnyDb, invoiceId: string) {
  return db.select().from(shipment).where(eq(shipment.invoiceId, invoiceId)).orderBy(desc(shipment.createdAt));
}

async function buyerEmailFor(db: AnyDb, accountId: string): Promise<string | null> {
  const [acct] = await db.select().from(account).where(eq(account.id, accountId)).limit(1);
  return acct?.primaryContactEmail ?? null;
}

/**
 * Create a shipment for an invoice. Only allowed when cleared funds cover
 * the invoice total — nothing ships before cleared funds. One active
 * shipment per invoice (a canceled shipment may be replaced).
 */
export async function createShipment(db: AnyDb, invoiceId: string, ownerId: string, input: ShipmentInput) {
  const carrier = clean(input.carrier, 120);
  const trackingNumber = clean(input.trackingNumber, 120);
  const notes = (input.notes ?? "").trim() || null;
  if (notes && notes.length > 2000) throw new ShipmentError("Notes are too long (max 2000 characters).", 400);

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv) throw new ShipmentError("Invoice not found.", 404);
  if (inv.status === "void") throw new ShipmentError("Cannot ship a void invoice.", 400);

  const detail = await getInvoiceDetail(db, invoiceId);
  if (!detail.readyForFulfillment) {
    throw new ShipmentError(
      "This invoice is not ready for fulfillment yet — cleared funds must cover the total first.",
      400,
    );
  }

  const [active] = await db
    .select()
    .from(shipment)
    .where(and(eq(shipment.invoiceId, invoiceId), ne(shipment.status, "canceled")))
    .limit(1);
  if (active) throw new ShipmentError("This invoice already has an active shipment.", 409);

  const [created] = await db
    .insert(shipment)
    .values({
      invoiceId: inv.id,
      accountId: inv.accountId,
      carrier,
      trackingNumber,
      notes,
      status: "preparing",
      createdBy: ownerId,
    })
    .returning();

  await recordAudit(
    {
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "shipment.created",
      entityType: "shipment",
      entityId: created!.id,
      after: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, carrier, trackingNumber },
    },
    db,
  );
  return created!;
}

/** preparing → shipped. Notifies the buyer with carrier and tracking. */
export async function markShipmentShipped(db: AnyDb, shipmentId: string, ownerId: string) {
  const row = await getShipment(db, shipmentId);
  if (row.status !== "preparing") throw new ShipmentError(`Only shipments being prepared can be marked shipped (now: ${row.status}).`, 409);

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, row.invoiceId)).limit(1);
  const now = new Date();
  const [updated] = await db
    .update(shipment)
    .set({ status: "shipped", shippedAt: now })
    .where(eq(shipment.id, shipmentId))
    .returning();

  await recordAudit(
    {
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "shipment.shipped",
      entityType: "shipment",
      entityId: row.id,
      after: { invoiceNumber: inv?.invoiceNumber, carrier: row.carrier, trackingNumber: row.trackingNumber },
    },
    db,
  );

  const to = await buyerEmailFor(db, row.accountId);
  if (to) {
    await sendNotificationEmail(
      {
        to,
        subject: `Your Fanzia order has shipped${inv ? ` (${inv.invoiceNumber})` : ""}`,
        text:
          `Your Fanzia wholesale order${inv ? ` for invoice ${inv.invoiceNumber}` : ""} has shipped.\n\n` +
          `Carrier: ${row.carrier}\nTracking: ${row.trackingNumber}\n\n` +
          `Track it with your carrier using the number above.`,
      },
      "shipment.shipped",
    );
  }
  return updated!;
}

/** shipped → delivered. Notifies the buyer. */
export async function markShipmentDelivered(db: AnyDb, shipmentId: string, ownerId: string) {
  const row = await getShipment(db, shipmentId);
  if (row.status !== "shipped") throw new ShipmentError(`Only shipped shipments can be marked delivered (now: ${row.status}).`, 409);

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, row.invoiceId)).limit(1);
  const now = new Date();
  const [updated] = await db
    .update(shipment)
    .set({ status: "delivered", deliveredAt: now })
    .where(eq(shipment.id, shipmentId))
    .returning();

  await recordAudit(
    {
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "shipment.delivered",
      entityType: "shipment",
      entityId: row.id,
      after: { invoiceNumber: inv?.invoiceNumber, carrier: row.carrier, trackingNumber: row.trackingNumber },
    },
    db,
  );

  const to = await buyerEmailFor(db, row.accountId);
  if (to) {
    await sendNotificationEmail(
      {
        to,
        subject: `Your Fanzia order was delivered${inv ? ` (${inv.invoiceNumber})` : ""}`,
        text:
          `Your Fanzia wholesale order${inv ? ` for invoice ${inv.invoiceNumber}` : ""} was marked delivered ` +
          `by ${row.carrier}.\n\nTracking: ${row.trackingNumber}\n\n` +
          `If anything arrived damaged or short, let us know promptly so we can make it right.`,
      },
      "shipment.delivered",
    );
  }
  return updated!;
}

/** preparing → canceled. A canceled shipment may be replaced with a new one. */
export async function cancelShipment(db: AnyDb, shipmentId: string, ownerId: string, reason?: string) {
  const row = await getShipment(db, shipmentId);
  if (row.status !== "preparing") throw new ShipmentError(`Only shipments being prepared can be canceled (now: ${row.status}).`, 409);

  const cancelReason = (reason ?? "").trim() || null;
  if (cancelReason && cancelReason.length > 2000) throw new ShipmentError("Reason is too long (max 2000 characters).", 400);

  const [updated] = await db
    .update(shipment)
    .set({ status: "canceled", cancelReason })
    .where(eq(shipment.id, shipmentId))
    .returning();

  await recordAudit(
    {
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "shipment.canceled",
      entityType: "shipment",
      entityId: row.id,
      after: { cancelReason },
    },
    db,
  );
  return updated!;
}
