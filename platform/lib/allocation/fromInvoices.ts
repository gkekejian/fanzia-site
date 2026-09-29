import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  account,
  allocationDrop,
  allocationLine,
  allocationOffer,
  allocationRound,
  invoice,
  payment,
  refundDue,
  sourcingRoute,
  type OrderRequestLine,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Drop-cycle automation (second review pass, 2026-09-23).
 *
 * Before: order requests became invoices, but allocation rounds were a
 * separate screen where an owner re-typed every buyer's quantities by hand.
 * Now a round pulls its lines straight from PAID invoices, and closing the
 * round settles any supplier shortfall back to the buyer automatically.
 */

export type SyncResult = { added: number; skippedAlreadyInRound: number; invoicesScanned: number };

/**
 * Add one allocation line per (paid invoice, product) whose product is
 * sourced from this round's supplier. Idempotent: the unique index on
 * (source_invoice_id, product_id) means a line is only ever pulled into ONE
 * round, so running this twice, or on two rounds, never double-counts.
 */
export async function syncPaidInvoicesIntoRound(db: AnyDb, roundId: string, actorUserId: string | null): Promise<SyncResult> {
  const [round] = await db.select().from(allocationRound).where(eq(allocationRound.id, roundId)).limit(1);
  if (!round) throw new Error("Allocation round not found.");
  if (round.status !== "collecting") throw new Error(`Only a collecting round can pull orders (this one is ${round.status}).`);

  const routes = await db
    .select({ productId: sourcingRoute.productId })
    .from(sourcingRoute)
    .where(and(eq(sourcingRoute.supplierId, round.supplierId), eq(sourcingRoute.active, true)));
  const supplierProducts = new Set(routes.map((r) => r.productId));
  if (supplierProducts.size === 0) return { added: 0, skippedAlreadyInRound: 0, invoicesScanned: 0 };

  const paid = await db.select().from(invoice).where(eq(invoice.status, "paid"));
  // Allocation-offer invoices count only once their offer is accepted, and
  // only in the round their drop is tied to (when it is tied to one).
  const offerIds = paid.map((i) => i.allocationOfferId).filter((x): x is string => Boolean(x));
  const offerRows = offerIds.length
    ? await db
        .select({ id: allocationOffer.id, status: allocationOffer.status, roundId: allocationDrop.supplierRoundId })
        .from(allocationOffer)
        .innerJoin(allocationDrop, eq(allocationOffer.dropId, allocationDrop.id))
        .where(inArray(allocationOffer.id, offerIds))
    : [];
  const offerById = new Map(offerRows.map((o) => [o.id, o]));
  // Anything already pulled into any round stays there.
  const already = await db
    .select({ invoiceId: allocationLine.sourceInvoiceId, productId: allocationLine.productId })
    .from(allocationLine)
    .where(isNotNull(allocationLine.sourceInvoiceId));
  const taken = new Set(already.map((a) => `${a.invoiceId}:${a.productId}`));

  let added = 0;
  let skipped = 0;
  for (const inv of paid) {
    if (round.cutoffAt && inv.createdAt > round.cutoffAt) continue;
    if (inv.allocationOfferId) {
      const offer = offerById.get(inv.allocationOfferId);
      if (!offer || offer.status !== "accepted") continue;
      if (offer.roundId && offer.roundId !== roundId) continue;
    }
    // Merge duplicate product lines within one invoice.
    const qtyByProduct = new Map<string, number>();
    for (const line of (inv.lines ?? []) as OrderRequestLine[]) {
      if (!line?.productId || !(line.qtyRequested > 0) || !supplierProducts.has(line.productId)) continue;
      qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qtyRequested);
    }
    for (const [productId, qty] of qtyByProduct) {
      if (taken.has(`${inv.id}:${productId}`)) {
        skipped++;
        continue;
      }
      const inserted = await db
        .insert(allocationLine)
        .values({
          roundId,
          accountId: inv.accountId,
          productId,
          requestedQty: qty,
          sourceInvoiceId: inv.id,
          notes: `From paid invoice ${inv.invoiceNumber}`,
        })
        .onConflictDoNothing()
        .returning({ id: allocationLine.id });
      if (inserted.length > 0) {
        added++;
        taken.add(`${inv.id}:${productId}`);
      } else {
        skipped++;
      }
    }
  }

  await recordAudit(
    {
      actorUserId,
      actorRole: actorUserId ? "owner" : null,
      actorType: actorUserId ? "owner" : "system",
      action: "allocation_round.synced_paid_invoices",
      entityType: "allocation_round",
      entityId: roundId,
      after: { added, skipped, invoicesScanned: paid.length },
    },
    db,
  );
  return { added, skippedAlreadyInRound: skipped, invoicesScanned: paid.length };
}

export type Shortfall = {
  invoiceId: string;
  accountId: string;
  amountMinor: number;
  lines: { productId: string; name: string; requestedQty: number; allocatedQty: number; unitPriceMinor: number }[];
};

/**
 * Pure: given a closed round's invoice-backed lines and the invoices they
 * came from, what does each buyer get back? Shortfall = missing units ×
 * the unit price they paid. If NOTHING on an invoice was filled and the
 * invoice was sourced entirely from this round, the small-order fee is
 * refunded too (they received nothing). Never exceeds the invoice total.
 */
export function computeShortfalls(
  lines: { sourceInvoiceId: string | null; productId: string; requestedQty: number; allocatedQty: number }[],
  invoices: { id: string; accountId: string; totalMinor: number; smallOrderFeeMinor: number; lines: OrderRequestLine[] }[],
): Shortfall[] {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const byInvoice = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.sourceInvoiceId) continue;
    const list = byInvoice.get(l.sourceInvoiceId) ?? [];
    list.push(l);
    byInvoice.set(l.sourceInvoiceId, list);
  }

  const out: Shortfall[] = [];
  for (const [invoiceId, invLines] of byInvoice) {
    const inv = invById.get(invoiceId);
    if (!inv) continue;
    const priceByProduct = new Map<string, { unit: number; name: string }>();
    for (const il of inv.lines ?? []) priceByProduct.set(il.productId, { unit: il.unitPriceMinor, name: il.name });

    let amount = 0;
    const detail: Shortfall["lines"] = [];
    for (const l of invLines) {
      const missing = Math.max(0, l.requestedQty - l.allocatedQty);
      const price = priceByProduct.get(l.productId);
      if (missing === 0 || !price) continue;
      amount += missing * price.unit;
      detail.push({ productId: l.productId, name: price.name, requestedQty: l.requestedQty, allocatedQty: l.allocatedQty, unitPriceMinor: price.unit });
    }
    if (amount <= 0) continue;

    const nothingFilled = invLines.every((l) => l.allocatedQty === 0);
    const coversWholeInvoice = new Set(invLines.map((l) => l.productId)).size === new Set((inv.lines ?? []).map((l) => l.productId)).size;
    if (nothingFilled && coversWholeInvoice) amount += inv.smallOrderFeeMinor ?? 0;

    out.push({ invoiceId, accountId: inv.accountId, amountMinor: Math.min(amount, inv.totalMinor), lines: detail });
  }
  return out;
}

export type CardRefunder = (args: { paymentIntentId: string; amountMinor: number; idempotencyKey: string }) => Promise<{ id: string }>;

export type SettleResult = { refundsCreated: number; autoRefunded: number; pendingManual: number; failed: number; totalMinor: number };

/**
 * Called when an owner approves (closes) a round. Records a refund_due per
 * short-shipped invoice, refunds card payments through Stripe when the
 * owner turned that on, emails the buyer, and leaves everything else on
 * the Today page. Idempotent per (invoice, round).
 */
export async function settleRoundShortfalls(
  db: AnyDb,
  roundId: string,
  opts: {
    autoRefundCards: boolean;
    refundCard?: CardRefunder;
    sendEmail?: (p: { to: string; subject: string; text: string }) => Promise<void>;
    notify?: (e: { title: string; body: string; urgent?: boolean }) => Promise<void>;
  },
): Promise<SettleResult> {
  const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, roundId));
  const invoiceIds = [...new Set(lines.map((l) => l.sourceInvoiceId).filter((x): x is string => Boolean(x)))];
  const result: SettleResult = { refundsCreated: 0, autoRefunded: 0, pendingManual: 0, failed: 0, totalMinor: 0 };
  if (invoiceIds.length === 0) return result;

  const invs = await db.select().from(invoice).where(inArray(invoice.id, invoiceIds));
  const shortfalls = computeShortfalls(
    lines,
    invs.map((i) => ({
      id: i.id,
      accountId: i.accountId,
      totalMinor: i.totalMinor,
      smallOrderFeeMinor: i.smallOrderFeeMinor,
      lines: (i.lines ?? []) as OrderRequestLine[],
    })),
  );

  for (const sf of shortfalls) {
    const [created] = await db
      .insert(refundDue)
      .values({
        invoiceId: sf.invoiceId,
        accountId: sf.accountId,
        roundId,
        amountMinor: sf.amountMinor,
        reason: `Supplier shortfall: ${sf.lines.map((l) => `${l.name} ${l.allocatedQty}/${l.requestedQty}`).join(", ")}`,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) continue; // already settled on a previous close attempt
    result.refundsCreated++;
    result.totalMinor += sf.amountMinor;

    const inv = invs.find((i) => i.id === sf.invoiceId)!;
    const cardPayments = (await db.select().from(payment).where(eq(payment.invoiceId, sf.invoiceId))).filter(
      (p) => p.method === "card" && p.reference && p.amountMinor >= sf.amountMinor,
    );
    const card = cardPayments.sort((a, b) => b.amountMinor - a.amountMinor)[0];

    let outcome: "refunded" | "pending" | "failed" = "pending";
    if (opts.autoRefundCards && card && opts.refundCard) {
      try {
        const refund = await opts.refundCard({
          paymentIntentId: card.reference!,
          amountMinor: sf.amountMinor,
          idempotencyKey: `refund_due_${created.id}`,
        });
        await db
          .update(refundDue)
          .set({ status: "refunded", method: "card", stripeRefundId: refund.id, resolvedAt: new Date() })
          .where(eq(refundDue.id, created.id));
        outcome = "refunded";
        result.autoRefunded++;
      } catch (err) {
        await db
          .update(refundDue)
          .set({ status: "failed", method: "card", lastError: (err as Error).message.slice(0, 300) })
          .where(eq(refundDue.id, created.id));
        outcome = "failed";
        result.failed++;
      }
    } else {
      await db.update(refundDue).set({ method: card ? "card" : "manual" }).where(eq(refundDue.id, created.id));
      result.pendingManual++;
    }

    await recordAudit(
      {
        actorType: "system",
        action: `refund_due.${outcome === "refunded" ? "auto_refunded" : outcome === "failed" ? "auto_refund_failed" : "created"}`,
        entityType: "refund_due",
        entityId: created.id,
        after: { invoiceId: sf.invoiceId, invoiceNumber: inv.invoiceNumber, amountMinor: sf.amountMinor, roundId },
      },
      db,
    );

    const [acct] = await db.select().from(account).where(eq(account.id, sf.accountId)).limit(1);
    if (acct?.primaryContactEmail && opts.sendEmail) {
      const items = sf.lines.map((l) => `- ${l.name}: ${l.allocatedQty} of ${l.requestedQty} filled`).join("\n");
      await opts.sendEmail({
        to: acct.primaryContactEmail,
        subject: `Fanzia order ${inv.invoiceNumber}: partial fill, ${formatMoney(sf.amountMinor)} refund`,
        text:
          `Our supplier shipped less than we ordered for your invoice ${inv.invoiceNumber}.\n\n${items}\n\n` +
          (outcome === "refunded"
            ? `We refunded ${formatMoney(sf.amountMinor)} to the card you paid with. It usually shows within 5 to 10 business days.`
            : `You'll receive a ${formatMoney(sf.amountMinor)} refund for the missing items. We'll confirm when it's sent.`) +
          `\n\nEverything that was filled ships as normal.`,
      });
    }
  }

  if (opts.notify && result.refundsCreated > 0) {
    const manual = result.pendingManual + result.failed;
    await opts.notify({
      title: `Round closed with shortfalls: ${formatMoney(result.totalMinor)} owed to ${result.refundsCreated} buyer(s)`,
      body:
        `${result.autoRefunded} refunded to cards automatically. ` +
        (manual > 0 ? `${manual} need you to pay back by ACH/wire (or retry a failed card refund) on the Today page.` : "Nothing for you to do."),
      urgent: result.failed > 0,
    });
  }
  return result;
}

/** Owner marks a pending/failed refund as paid back outside Stripe. */
export async function markRefundResolved(db: AnyDb, refundId: string, ownerId: string, method: string): Promise<boolean> {
  const updated = await db
    .update(refundDue)
    .set({ status: "refunded", method, resolvedBy: ownerId, resolvedAt: new Date() })
    .where(and(eq(refundDue.id, refundId), inArray(refundDue.status, ["pending", "failed"])))
    .returning({ id: refundDue.id });
  if (updated.length === 0) return false;
  await recordAudit(
    { actorUserId: ownerId, actorRole: "owner", actorType: "owner", action: "refund_due.marked_refunded", entityType: "refund_due", entityId: refundId, after: { method } },
    db,
  );
  return true;
}
