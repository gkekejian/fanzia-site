import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  allocationDrop,
  allocationDropItem,
  allocationLine,
  allocationOffer,
  allocationRound,
  HOLDING_OFFER_STATUSES,
  product,
  supplier,
  type AllocationOfferRow,
  type OfferStatus,
  type ScoreDetail,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { loadConfig } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { notifyOwnersEvent } from "@/lib/notifications";
import { ALLOCATION_POLICY_SNAPSHOT } from "@/lib/allocation/engine";
import { syncPaidInvoicesIntoRound } from "@/lib/allocation/fromInvoices";
import { suggestSplit, validatePlan } from "./engine";
import {
  accountFacts,
  incrementFor,
  interestByProduct,
  internalAccountId,
  OfferError,
  productFacts,
  scoreAccounts,
} from "./context";
import { emailOffers, processOfferDeadlines, reofferItem, retireLiveOffer } from "./lifecycle";
import { cardGateway, type CardGateway } from "./payments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Owner side of allocation drops (docs/allocation-design.md §3, §5, §6):
 * build a drop, get a suggested split, edit it, send it, then turn paid
 * offers into a supplier round.
 */

const MAX_QTY = 100_000;

function audit(db: AnyDb, ownerId: string | null, action: string, entityId: string, after: Record<string, unknown>) {
  return recordAudit(
    { actorUserId: ownerId, actorRole: ownerId ? "owner" : null, actorType: ownerId ? "owner" : "system", action, entityType: "allocation_drop", entityId, after },
    db,
  );
}

async function loadDrop(db: AnyDb, dropId: string) {
  const [drop] = await db.select().from(allocationDrop).where(eq(allocationDrop.id, dropId)).limit(1);
  if (!drop) throw new OfferError("Drop not found.", 404);
  return drop;
}

function requireDraft(status: string) {
  if (status !== "draft") throw new OfferError("Only a draft drop can be changed this way.", 409);
}

function wholeQty(raw: unknown, label: string, min = 0): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > MAX_QTY) throw new OfferError(`${label} must be a whole number from ${min} to ${MAX_QTY}.`);
  return n;
}

// ── Create / edit ─────────────────────────────────────────────────────────

export async function createDrop(
  db: AnyDb,
  ownerId: string | null,
  input: { name: unknown; supplierId?: unknown; notes?: unknown },
) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 200) throw new OfferError("Give the drop a name (up to 200 characters).");
  const supplierId = typeof input.supplierId === "string" && input.supplierId ? input.supplierId : null;
  if (supplierId) {
    const [s] = await db.select({ id: supplier.id }).from(supplier).where(eq(supplier.id, supplierId)).limit(1);
    if (!s) throw new OfferError("Supplier not found.", 404);
  }
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 2000) : null;
  const config = await loadConfig(db);
  const [drop] = await db
    .insert(allocationDrop)
    .values({
      name,
      supplierId,
      notes,
      createdBy: ownerId,
      offerWindowHours: config.offer_window_hours,
      reofferWindowHours: config.reoffer_window_hours,
    })
    .returning();
  await audit(db, ownerId, "allocation_drop.created", drop!.id, { name, supplierId });
  return drop!;
}

/**
 * Add a product to a drop or change it. Draft: anything. Live: only the
 * available quantity, and never below what's already offered or sold
 * (the supplier confirmed more, or less, than planned). More stock on a
 * live drop is offered to the next buyers in line right away.
 */
export async function setDropItem(
  db: AnyDb,
  ownerId: string | null,
  dropId: string,
  input: { productId: unknown; availableQty: unknown; unitPriceMinor?: unknown; increment?: unknown },
  now = new Date(),
) {
  const drop = await loadDrop(db, dropId);
  if (drop.status !== "draft" && drop.status !== "live") throw new OfferError("This drop is closed.", 409);
  const productId = typeof input.productId === "string" ? input.productId : "";
  const [p] = productId ? await db.select().from(product).where(eq(product.id, productId)).limit(1) : [];
  if (!p) throw new OfferError("Product not found.", 404);
  const availableQty = wholeQty(input.availableQty, "Available quantity");

  const [existing] = await db
    .select()
    .from(allocationDropItem)
    .where(and(eq(allocationDropItem.dropId, dropId), eq(allocationDropItem.productId, productId)))
    .limit(1);

  if (drop.status === "live") {
    if (!existing) throw new OfferError("A live drop can't take new products. Start another drop.", 409);
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(allocationDropItem).where(eq(allocationDropItem.id, existing.id)).for("update").limit(1);
      const held = await tx
        .select({ qty: allocationOffer.qty })
        .from(allocationOffer)
        .where(and(eq(allocationOffer.itemId, item!.id), inArray(allocationOffer.status, HOLDING_OFFER_STATUSES)));
      const heldQty = held.reduce((s, r) => s + r.qty, 0);
      if (availableQty < heldQty) {
        throw new OfferError(
          `${heldQty} units are already offered, reserved or sold. To go lower, cancel open offers first; paid ones are refunded through the supplier round.`,
          409,
        );
      }
      if (availableQty % item!.increment !== 0) throw new OfferError(`Available quantity must be a multiple of ${item!.increment}.`);
      const [updated] = await tx.update(allocationDropItem).set({ availableQty }).where(eq(allocationDropItem.id, item!.id)).returning();
      await audit(tx, ownerId, "allocation_drop.item_quantity_changed", dropId, { productId, before: item!.availableQty, after: availableQty });
      return { updated: updated!, grew: availableQty > item!.availableQty };
    });
    if (result.grew) await reofferItem(db, result.updated.id, now);
    return result.updated;
  }

  const config = await loadConfig(db);
  const facts = (await productFacts(db, [productId])).get(productId);
  const unitPriceMinor =
    input.unitPriceMinor === undefined || input.unitPriceMinor === null || input.unitPriceMinor === ""
      ? facts?.priceMinor ?? null
      : wholeQty(input.unitPriceMinor, "Price", 1);
  if (!unitPriceMinor || unitPriceMinor <= 0) throw new OfferError("This product has no price yet. Enter a price for the drop.");
  const increment =
    input.increment === undefined || input.increment === null || input.increment === ""
      ? incrementFor(p, config.case_only_mode)
      : wholeQty(input.increment, "Increment", 1);
  if (availableQty % increment !== 0) throw new OfferError(`Available quantity must be a multiple of ${increment}.`);

  if (existing) {
    const [updated] = await db
      .update(allocationDropItem)
      .set({ availableQty, unitPriceMinor, increment })
      .where(eq(allocationDropItem.id, existing.id))
      .returning();
    // Proposals were made for the old numbers; the owner re-suggests.
    await db.delete(allocationOffer).where(and(eq(allocationOffer.itemId, existing.id), eq(allocationOffer.status, "proposed")));
    await audit(db, ownerId, "allocation_drop.item_changed", dropId, { productId, availableQty, unitPriceMinor, increment });
    return updated!;
  }
  const [created] = await db
    .insert(allocationDropItem)
    .values({ dropId, productId, availableQty, unitPriceMinor, increment })
    .returning();
  await audit(db, ownerId, "allocation_drop.item_added", dropId, { productId, availableQty, unitPriceMinor, increment });
  return created!;
}

export async function removeDropItem(db: AnyDb, ownerId: string | null, dropId: string, itemId: string) {
  const drop = await loadDrop(db, dropId);
  requireDraft(drop.status);
  const deleted = await db
    .delete(allocationDropItem)
    .where(and(eq(allocationDropItem.id, itemId), eq(allocationDropItem.dropId, dropId)))
    .returning();
  if (deleted.length === 0) throw new OfferError("Item not found.", 404);
  await audit(db, ownerId, "allocation_drop.item_removed", dropId, { productId: deleted[0]!.productId });
}

// ── Suggest / edit proposals ──────────────────────────────────────────────

/** Replace every proposal on a draft drop with the suggested split (docs §5). */
export async function suggestDrop(db: AnyDb, ownerId: string | null, dropId: string, now = new Date()) {
  const drop = await loadDrop(db, dropId);
  requireDraft(drop.status);
  const items = await db.select().from(allocationDropItem).where(eq(allocationDropItem.dropId, dropId));
  if (items.length === 0) throw new OfferError("Add at least one product first.");
  const interest = await interestByProduct(db, items.map((i) => i.productId));
  const accountIds = new Set<string>();
  for (const m of interest.values()) for (const id of m.keys()) accountIds.add(id);
  const accts = await accountFacts(db, [...accountIds]);
  const internalId = await internalAccountId(db);
  const eligibleExternal = [...accountIds].filter((id) => accts.get(id)?.kind === "external" && accts.get(id)?.ineligibleReason === null);
  const scores = await scoreAccounts(db, eligibleExternal, now);

  const summary: { productId: string; internalQty: number; offers: number; leftover: number }[] = [];
  await db.transaction(async (tx) => {
    await tx.delete(allocationOffer).where(and(eq(allocationOffer.dropId, dropId), eq(allocationOffer.status, "proposed")));
    for (const item of items) {
      const wants = interest.get(item.productId) ?? new Map<string, number>();
      const internalNeed =
        internalId && wants.has(internalId) && accts.get(internalId)?.ineligibleReason === null ? wants.get(internalId)! : 0;
      const split = suggestSplit({
        available: item.availableQty,
        increment: item.increment,
        internalNeed,
        candidates: eligibleExternal
          .filter((id) => wants.has(id))
          .map((id) => ({ accountId: id, score: scores.get(id)?.total ?? 0, need: wants.get(id)!, tiebreak: accts.get(id)!.createdAt.toISOString() })),
      });
      const rows: (typeof allocationOffer.$inferInsert)[] = [];
      if (split.internalQty > 0 && internalId) {
        rows.push({
          dropId,
          itemId: item.id,
          accountId: internalId,
          qty: split.internalQty,
          unitPriceMinor: item.unitPriceMinor,
          totalMinor: item.unitPriceMinor * split.internalQty,
          status: "proposed",
          createdBy: ownerId,
        });
      }
      for (const a of split.allocations) {
        const score = scores.get(a.accountId) ?? null;
        rows.push({
          dropId,
          itemId: item.id,
          accountId: a.accountId,
          qty: a.qty,
          unitPriceMinor: item.unitPriceMinor,
          totalMinor: item.unitPriceMinor * a.qty,
          status: "proposed",
          score: score?.total ?? null,
          scoreDetail: score,
          createdBy: ownerId,
        });
      }
      if (rows.length) await tx.insert(allocationOffer).values(rows);
      summary.push({ productId: item.productId, internalQty: split.internalQty, offers: split.allocations.length, leftover: split.leftover });
    }
    await audit(tx, ownerId, "allocation_drop.suggested", dropId, { items: summary });
  });
  return summary;
}

/** Owner edits one product's split. qty 0 removes that buyer. */
export async function setProposal(
  db: AnyDb,
  ownerId: string | null,
  dropId: string,
  itemId: string,
  rawPlan: unknown,
  now = new Date(),
) {
  const drop = await loadDrop(db, dropId);
  requireDraft(drop.status);
  const [item] = await db
    .select()
    .from(allocationDropItem)
    .where(and(eq(allocationDropItem.id, itemId), eq(allocationDropItem.dropId, dropId)))
    .limit(1);
  if (!item) throw new OfferError("Item not found.", 404);
  if (!Array.isArray(rawPlan)) throw new OfferError("plan must be a list of { accountId, qty }.");
  const plan = rawPlan.map((r) => ({
    accountId: typeof r?.accountId === "string" ? r.accountId : "",
    qty: wholeQty(r?.qty, "Quantity"),
  }));
  if (plan.some((p) => !p.accountId)) throw new OfferError("Every row needs an account.");
  const problem = validatePlan(plan, item.availableQty, item.increment);
  if (problem) throw new OfferError(problem);

  const live = plan.filter((p) => p.qty > 0);
  const accts = await accountFacts(db, live.map((p) => p.accountId));
  for (const p of live) {
    const a = accts.get(p.accountId);
    if (!a) throw new OfferError("Account not found.", 404);
    if (a.ineligibleReason) throw new OfferError(`${a.legalName} can't receive offers: ${a.ineligibleReason}.`, 409);
  }
  const scores = await scoreAccounts(db, live.filter((p) => accts.get(p.accountId)?.kind === "external").map((p) => p.accountId), now);

  await db.transaction(async (tx) => {
    await tx.delete(allocationOffer).where(and(eq(allocationOffer.itemId, itemId), eq(allocationOffer.status, "proposed")));
    if (live.length) {
      await tx.insert(allocationOffer).values(
        live.map((p) => {
          const score: ScoreDetail | null = scores.get(p.accountId) ?? null;
          return {
            dropId,
            itemId,
            accountId: p.accountId,
            qty: p.qty,
            unitPriceMinor: item.unitPriceMinor,
            totalMinor: item.unitPriceMinor * p.qty,
            status: "proposed" as const,
            score: score?.total ?? null,
            scoreDetail: score,
            createdBy: ownerId,
          };
        }),
      );
    }
    await audit(tx, ownerId, "allocation_drop.proposal_edited", dropId, { itemId, productId: item.productId, plan: live });
  });
}

// ── Send / close ──────────────────────────────────────────────────────────

/**
 * Send a draft drop: internal proposals become reserved, every other
 * proposal becomes a live offer with a deadline, and buyers get one email
 * each. Eligibility is checked again at send time.
 */
export async function sendDrop(db: AnyDb, ownerId: string | null, dropId: string, now = new Date()) {
  const sent = await db.transaction(async (tx) => {
    const [drop] = await tx.select().from(allocationDrop).where(eq(allocationDrop.id, dropId)).for("update").limit(1);
    if (!drop) throw new OfferError("Drop not found.", 404);
    requireDraft(drop.status);
    const proposals = await tx
      .select()
      .from(allocationOffer)
      .where(and(eq(allocationOffer.dropId, dropId), eq(allocationOffer.status, "proposed")));
    if (proposals.length === 0) throw new OfferError("Nothing to send. Suggest a split or add buyers first.");
    const accts = await accountFacts(tx, [...new Set(proposals.map((p) => p.accountId))]);
    const problems = proposals
      .map((p) => accts.get(p.accountId))
      .filter((a) => !a || a.ineligibleReason)
      .map((a) => (a ? `${a.legalName}: ${a.ineligibleReason}` : "An account no longer exists"));
    if (problems.length) throw new OfferError(`Fix these before sending: ${[...new Set(problems)].join("; ")}.`, 409);

    const expiresAt = new Date(now.getTime() + drop.offerWindowHours * 3_600_000);
    const offered: string[] = [];
    for (const p of proposals) {
      const internal = accts.get(p.accountId)!.kind === "internal";
      await tx
        .update(allocationOffer)
        .set(
          internal
            ? { status: "reserved", sentAt: now, respondedAt: now, updatedAt: now }
            : { status: "offered", sentAt: now, expiresAt, updatedAt: now },
        )
        .where(eq(allocationOffer.id, p.id));
      if (!internal) offered.push(p.id);
    }
    await tx.update(allocationDrop).set({ status: "live", sentAt: now, updatedAt: now }).where(eq(allocationDrop.id, dropId));
    const totalMinor = proposals.filter((p) => accts.get(p.accountId)!.kind === "external").reduce((s, p) => s + p.totalMinor, 0);
    await audit(tx, ownerId, "allocation_drop.sent", dropId, { offers: offered.length, reserved: proposals.length - offered.length, totalMinor, expiresAt: expiresAt.toISOString() });
    return { drop, offered, totalMinor, expiresAt, buyers: new Set(offered.map((id) => proposals.find((p) => p.id === id)!.accountId)).size };
  });

  await emailOffers(db, sent.offered);
  await notifyOwnersEvent(
    {
      type: "offers_sent",
      title: `Offers sent — ${sent.drop.name}: ${sent.offered.length} offer${sent.offered.length === 1 ? "" : "s"}, ${formatMoney(sent.totalMinor)}`,
      body: `${sent.buyers} buyer${sent.buyers === 1 ? "" : "s"} have until ${sent.expiresAt.toUTCString()} to accept and pay. Declines and no-responses are re-offered automatically.`,
      entityType: "allocation_drop",
      entityId: dropId,
    },
    db,
  );
  return { offers: sent.offered.length };
}

/** Owner withdraws one live or proposed offer. Doesn't count against the buyer's score. */
export async function cancelOffer(db: AnyDb, ownerId: string | null, dropId: string, offerId: string, opts: { now?: Date; gateway?: CardGateway } = {}) {
  const now = opts.now ?? new Date();
  const gateway = opts.gateway ?? cardGateway();
  const [offer] = await db
    .select()
    .from(allocationOffer)
    .where(and(eq(allocationOffer.id, offerId), eq(allocationOffer.dropId, dropId)))
    .limit(1);
  if (!offer) throw new OfferError("Offer not found.", 404);
  if (offer.status === "proposed" || offer.status === "reserved") {
    const [done] = await db
      .update(allocationOffer)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(allocationOffer.id, offerId), eq(allocationOffer.status, offer.status)))
      .returning();
    if (!done) throw new OfferError("This offer just changed. Refresh and try again.", 409);
  } else {
    const outcome = await retireLiveOffer(db, offer, "cancelled", { now, gateway });
    if (outcome === "paid") throw new OfferError("The buyer already paid. Refunds go through the supplier round.", 409);
    if (outcome === "busy") throw new OfferError("The buyer is paying right now. Try again in a couple of minutes.", 409);
    if (outcome === "changed") throw new OfferError("This offer is no longer open.", 409);
  }
  await audit(db, ownerId, "allocation_drop.offer_cancelled", dropId, { offerId, accountId: offer.accountId, qty: offer.qty, was: offer.status });
}

/** Offer an item's free units to the next buyers in line now (instead of waiting for a deadline). */
export async function offerLeftovers(db: AnyDb, ownerId: string | null, dropId: string, itemId: string, now = new Date()) {
  const drop = await loadDrop(db, dropId);
  if (drop.status !== "live") throw new OfferError("Only a live drop can re-offer.", 409);
  const [item] = await db
    .select({ id: allocationDropItem.id })
    .from(allocationDropItem)
    .where(and(eq(allocationDropItem.id, itemId), eq(allocationDropItem.dropId, dropId)))
    .limit(1);
  if (!item) throw new OfferError("Item not found.", 404);
  const result = await reofferItem(db, itemId, now);
  await audit(db, ownerId, "allocation_drop.leftovers_offered", dropId, { itemId, ...result });
  return result;
}

/** Close a live drop once nothing is waiting on a buyer. */
export async function closeDrop(db: AnyDb, ownerId: string | null, dropId: string, now = new Date()) {
  await processOfferDeadlines(db, { dropId, now });
  const open = await db
    .select({ id: allocationOffer.id })
    .from(allocationOffer)
    .where(and(eq(allocationOffer.dropId, dropId), inArray(allocationOffer.status, ["offered", "paying"])));
  if (open.length) throw new OfferError(`${open.length} offer${open.length === 1 ? " is" : "s are"} still open. Wait for the deadline or cancel them first.`, 409);
  const [done] = await db
    .update(allocationDrop)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(and(eq(allocationDrop.id, dropId), eq(allocationDrop.status, "live")))
    .returning();
  if (!done) throw new OfferError("Only a live drop can be closed.", 409);
  await audit(db, ownerId, "allocation_drop.closed", dropId, {});
}

/** Throw away a draft drop. A sent drop is closed instead (it may hold payments). */
export async function cancelDrop(db: AnyDb, ownerId: string | null, dropId: string, now = new Date()) {
  const [done] = await db
    .update(allocationDrop)
    .set({ status: "cancelled", closedAt: now, updatedAt: now })
    .where(and(eq(allocationDrop.id, dropId), eq(allocationDrop.status, "draft")))
    .returning();
  if (!done) throw new OfferError("Only a draft can be cancelled. Close a sent drop instead.", 409);
  await db
    .update(allocationOffer)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(allocationOffer.dropId, dropId), eq(allocationOffer.status, "proposed")));
  await audit(db, ownerId, "allocation_drop.cancelled", dropId, {});
}

/**
 * Turn the drop's paid offers (plus the internal reservation) into a
 * supplier round so ordering, receiving and shortfall refunds use the
 * existing round workflow. Re-running "Pull paid invoices" on the round
 * later picks up offers paid after this.
 */
export async function createSupplierRound(db: AnyDb, ownerId: string | null, dropId: string) {
  const drop = await loadDrop(db, dropId);
  if (drop.status !== "live" && drop.status !== "closed") throw new OfferError("Send the drop first.", 409);
  if (!drop.supplierId) throw new OfferError("Set the drop's supplier first.", 409);
  if (drop.supplierRoundId) throw new OfferError("This drop already has a supplier round.", 409);
  const internalId = await internalAccountId(db);

  const roundId = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(allocationDrop).where(eq(allocationDrop.id, dropId)).for("update").limit(1);
    if (locked?.supplierRoundId) throw new OfferError("This drop already has a supplier round.", 409);
    const [round] = await tx
      .insert(allocationRound)
      .values({
        name: `${drop.name} (drop)`,
        supplierId: drop.supplierId!,
        internalAccountId: internalId,
        policySnapshot: { ...ALLOCATION_POLICY_SNAPSHOT },
        createdBy: ownerId,
      })
      .returning();
    const reserved = await tx
      .select({ offer: allocationOffer, item: allocationDropItem })
      .from(allocationOffer)
      .innerJoin(allocationDropItem, eq(allocationOffer.itemId, allocationDropItem.id))
      .where(and(eq(allocationOffer.dropId, dropId), eq(allocationOffer.status, "reserved")));
    const byKey = new Map<string, { accountId: string; productId: string; qty: number }>();
    for (const r of reserved) {
      const key = `${r.offer.accountId}:${r.item.productId}`;
      const cur = byKey.get(key) ?? { accountId: r.offer.accountId, productId: r.item.productId, qty: 0 };
      cur.qty += r.offer.qty;
      byKey.set(key, cur);
    }
    if (byKey.size) {
      await tx.insert(allocationLine).values(
        [...byKey.values()].map((l) => ({
          roundId: round!.id,
          accountId: l.accountId,
          productId: l.productId,
          requestedQty: l.qty,
          notes: `Internal reservation from drop "${drop.name}"`,
        })),
      );
    }
    await tx.update(allocationDrop).set({ supplierRoundId: round!.id, updatedAt: new Date() }).where(eq(allocationDrop.id, dropId));
    await audit(tx, ownerId, "allocation_drop.supplier_round_created", dropId, { roundId: round!.id, internalLines: byKey.size });
    return round!.id;
  });
  const synced = await syncPaidInvoicesIntoRound(db, roundId, ownerId);
  return { roundId, ...synced };
}

// ── Reads ─────────────────────────────────────────────────────────────────

export type DropListRow = {
  id: string;
  name: string;
  status: string;
  supplierName: string | null;
  items: number;
  offered: number;
  accepted: number;
  acceptedMinor: number;
  sentAt: string | null;
  createdAt: string;
};

export async function listDrops(db: AnyDb): Promise<DropListRow[]> {
  const drops = await db
    .select({ drop: allocationDrop, supplierName: supplier.name })
    .from(allocationDrop)
    .leftJoin(supplier, eq(allocationDrop.supplierId, supplier.id))
    .orderBy(desc(allocationDrop.createdAt))
    .limit(200);
  const ids = drops.map((d) => d.drop.id);
  const items = ids.length ? await db.select({ dropId: allocationDropItem.dropId }).from(allocationDropItem).where(inArray(allocationDropItem.dropId, ids)) : [];
  const offers = ids.length
    ? await db
        .select({ dropId: allocationOffer.dropId, status: allocationOffer.status, totalMinor: allocationOffer.totalMinor })
        .from(allocationOffer)
        .where(inArray(allocationOffer.dropId, ids))
    : [];
  return drops.map(({ drop, supplierName }) => {
    const mine = offers.filter((o) => o.dropId === drop.id);
    const accepted = mine.filter((o) => o.status === "accepted");
    return {
      id: drop.id,
      name: drop.name,
      status: drop.status,
      supplierName: supplierName ?? null,
      items: items.filter((i) => i.dropId === drop.id).length,
      offered: mine.filter((o) => o.status === "offered" || o.status === "paying").length,
      accepted: accepted.length,
      acceptedMinor: accepted.reduce((s, o) => s + o.totalMinor, 0),
      sentAt: drop.sentAt?.toISOString() ?? null,
      createdAt: drop.createdAt.toISOString(),
    };
  });
}

export type DropOfferView = {
  id: string;
  accountId: string;
  legalName: string;
  internal: boolean;
  qty: number;
  totalMinor: number;
  status: OfferStatus;
  wave: number;
  score: number | null;
  scoreNotes: string[];
  expiresAt: string | null;
  respondedAt: string | null;
  invoiceId: string | null;
  declineReason: string | null;
  lastPaymentError: string | null;
};

export type DropCandidateView = {
  accountId: string;
  legalName: string;
  internal: boolean;
  desiredQty: number;
  score: number | null;
  scoreNotes: string[];
  ineligibleReason: string | null;
};

export type DropItemView = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  sellUnit: string;
  unitPriceMinor: number;
  availableQty: number;
  increment: number;
  heldQty: number;
  acceptedQty: number;
  reservedQty: number;
  freeQty: number;
  demandQty: number;
  offers: DropOfferView[];
  candidates: DropCandidateView[];
};

export type DropDetail = {
  drop: {
    id: string;
    name: string;
    status: string;
    supplierId: string | null;
    notes: string | null;
    offerWindowHours: number;
    reofferWindowHours: number;
    sentAt: string | null;
    closedAt: string | null;
    supplierRoundId: string | null;
  };
  items: DropItemView[];
  totals: { acceptedMinor: number; openMinor: number; proposedMinor: number };
};

export async function getDropDetail(db: AnyDb, dropId: string, now = new Date()): Promise<DropDetail> {
  const drop = await loadDrop(db, dropId);
  if (drop.status === "live") await processOfferDeadlines(db, { dropId, now });
  const items = await db.select().from(allocationDropItem).where(eq(allocationDropItem.dropId, dropId));
  const offers: AllocationOfferRow[] = await db.select().from(allocationOffer).where(eq(allocationOffer.dropId, dropId));
  const productIds = items.map((i) => i.productId);
  const facts = await productFacts(db, productIds);
  const interest = await interestByProduct(db, productIds);
  const accountIds = new Set<string>(offers.map((o) => o.accountId));
  for (const m of interest.values()) for (const id of m.keys()) accountIds.add(id);
  const accts = await accountFacts(db, [...accountIds]);
  const scores = await scoreAccounts(db, [...accountIds].filter((id) => accts.get(id)?.kind === "external"), now);

  const itemViews: DropItemView[] = items.map((item) => {
    const f = facts.get(item.productId);
    const mine = offers.filter((o) => o.itemId === item.id);
    const holding = mine.filter((o) => HOLDING_OFFER_STATUSES.includes(o.status));
    const heldQty = holding.reduce((s, o) => s + o.qty, 0);
    const wants = interest.get(item.productId) ?? new Map<string, number>();
    const candidates: DropCandidateView[] = [...wants.entries()]
      .map(([accountId, desiredQty]) => {
        const a = accts.get(accountId);
        const s = scores.get(accountId);
        return {
          accountId,
          legalName: a?.legalName ?? "Unknown",
          internal: a?.kind === "internal",
          desiredQty,
          score: s?.total ?? null,
          scoreNotes: s?.notes ?? [],
          ineligibleReason: a?.ineligibleReason ?? "Account not found",
        };
      })
      .sort((a, b) => Number(b.internal) - Number(a.internal) || (b.score ?? -1) - (a.score ?? -1) || a.legalName.localeCompare(b.legalName));
    return {
      id: item.id,
      productId: item.productId,
      name: f?.name ?? "Product",
      sku: f?.sku ?? "",
      sellUnit: f?.sellUnit ?? "unit",
      unitPriceMinor: item.unitPriceMinor,
      availableQty: item.availableQty,
      increment: item.increment,
      heldQty,
      acceptedQty: mine.filter((o) => o.status === "accepted").reduce((s, o) => s + o.qty, 0),
      reservedQty: mine.filter((o) => o.status === "reserved").reduce((s, o) => s + o.qty, 0),
      freeQty: Math.max(0, item.availableQty - heldQty),
      demandQty: [...wants.values()].reduce((s, q) => s + q, 0),
      offers: mine
        .map((o) => {
          const a = accts.get(o.accountId);
          return {
            id: o.id,
            accountId: o.accountId,
            legalName: a?.legalName ?? "Unknown",
            internal: a?.kind === "internal",
            qty: o.qty,
            totalMinor: o.totalMinor,
            status: o.status,
            wave: o.wave,
            score: o.score,
            scoreNotes: o.scoreDetail?.notes ?? scores.get(o.accountId)?.notes ?? [],
            expiresAt: o.expiresAt?.toISOString() ?? null,
            respondedAt: o.respondedAt?.toISOString() ?? null,
            invoiceId: o.invoiceId,
            declineReason: o.declineReason,
            lastPaymentError: o.lastPaymentError,
          };
        })
        .sort((a, b) => a.wave - b.wave || Number(b.internal) - Number(a.internal) || (b.score ?? -1) - (a.score ?? -1)),
      candidates,
    };
  });

  const sum = (statuses: OfferStatus[]) => offers.filter((o) => statuses.includes(o.status)).reduce((s, o) => s + o.totalMinor, 0);
  const internalIds = new Set([...accts.values()].filter((a) => a.kind === "internal").map((a) => a.id));
  return {
    drop: {
      id: drop.id,
      name: drop.name,
      status: drop.status,
      supplierId: drop.supplierId,
      notes: drop.notes,
      offerWindowHours: drop.offerWindowHours,
      reofferWindowHours: drop.reofferWindowHours,
      sentAt: drop.sentAt?.toISOString() ?? null,
      closedAt: drop.closedAt?.toISOString() ?? null,
      supplierRoundId: drop.supplierRoundId,
    },
    items: itemViews,
    totals: {
      acceptedMinor: sum(["accepted"]),
      openMinor: sum(["offered", "paying"]),
      proposedMinor: offers.filter((o) => o.status === "proposed" && !internalIds.has(o.accountId)).reduce((s, o) => s + o.totalMinor, 0),
    },
  };
}

/** Owner Today counts: drafts waiting to send and live items with unclaimed units. */
export async function dropAttention(db: AnyDb): Promise<{ drafts: number; unclaimed: { dropId: string; dropName: string; productId: string; freeQty: number }[] }> {
  const drops = await db.select().from(allocationDrop).where(inArray(allocationDrop.status, ["draft", "live"]));
  const live = drops.filter((d) => d.status === "live");
  const unclaimed: { dropId: string; dropName: string; productId: string; freeQty: number }[] = [];
  if (live.length) {
    const items = await db.select().from(allocationDropItem).where(inArray(allocationDropItem.dropId, live.map((d) => d.id)));
    const held = items.length
      ? await db
          .select({ itemId: allocationOffer.itemId, qty: allocationOffer.qty, status: allocationOffer.status })
          .from(allocationOffer)
          .where(and(inArray(allocationOffer.itemId, items.map((i) => i.id)), inArray(allocationOffer.status, HOLDING_OFFER_STATUSES)))
      : [];
    for (const item of items) {
      const free = item.availableQty - held.filter((h) => h.itemId === item.id).reduce((s, h) => s + h.qty, 0);
      const anyLive = held.some((h) => h.itemId === item.id && (h.status === "offered" || h.status === "paying"));
      if (free >= item.increment && !anyLive) {
        unclaimed.push({ dropId: item.dropId, dropName: live.find((d) => d.id === item.dropId)!.name, productId: item.productId, freeQty: free });
      }
    }
  }
  return { drafts: drops.filter((d) => d.status === "draft").length, unclaimed };
}
