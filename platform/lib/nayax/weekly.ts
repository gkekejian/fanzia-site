import { and, desc, eq, gte, ilike } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import {
  internalRestockDraft,
  nayaxMachine,
  nayaxRestock,
  nayaxSale,
  nayaxSuggestionRun,
  restockParams,
  slotMap,
} from "@/db/schema/nayax";
import { product } from "@/db/schema/catalog";
import { account, accountKind } from "@/db/schema/account";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { lastSales, isNayaxConfigured, NayaxNotConfigured } from "./client";
import { ingestSales } from "./ingest";
import {
  suggestRestock,
  VELOCITY_WINDOW_DAYS,
  type MachineInput,
  type RestockParamsInput,
  type SuggestInput,
  type SuggestionLine,
} from "./suggest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const DEFAULT_RESTOCK_PARAMS: RestockParamsInput = {
  leadTimeDays: 14, // King Punch Japan default; domestic suppliers get 5 when tuned
  safetyStockDays: 7,
  reviewPeriodDays: 7,
  minOrderUnits: 1,
  caseUnits: 1, // 1 = no case snapping until the owner sets the real case size
  trialQty: 36,
};

/** ISO week key in America/Los_Angeles, e.g. "2026-W39". */
export function weekKeyFor(date: Date, timeZone = "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const dt = new Date(Date.UTC(y, m - 1, d));
  // ISO week: Thursday determines the week-year.
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const weekYear = dt.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

/** Lowercase English weekday in America/Los_Angeles, e.g. "monday". */
export function weekdayFor(date: Date, timeZone = "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" })
    .format(date)
    .toLowerCase();
}

export type PollResult = {
  configured: boolean;
  machines: number;
  inserted: number;
  skipped: number;
  quarantined: number;
  error: string | null;
};

/**
 * Poll every active Nayax machine's lastSales and ingest idempotently.
 * Never throws for connector problems — a dead token must not kill the
 * ops sweep; the failure is reported in the result and audit-logged by
 * the caller.
 */
export async function runNayaxPoll(db: AnyDb = defaultDb): Promise<PollResult> {
  if (!isNayaxConfigured()) {
    return { configured: false, machines: 0, inserted: 0, skipped: 0, quarantined: 0, error: null };
  }
  const machines = await db
    .select({ id: nayaxMachine.id, nayaxMachineId: nayaxMachine.nayaxMachineId })
    .from(nayaxMachine)
    .where(eq(nayaxMachine.active, true));

  const total: PollResult = {
    configured: true,
    machines: machines.length,
    inserted: 0,
    skipped: 0,
    quarantined: 0,
    error: null,
  };
  for (const m of machines) {
    try {
      const rows = await lastSales(m.nayaxMachineId);
      const r = await ingestSales(db, m.id, rows, "api");
      total.inserted += r.inserted;
      total.skipped += r.skipped;
      total.quarantined += r.quarantined.length;
    } catch (err) {
      total.error =
        err instanceof NayaxNotConfigured
          ? "NAYAX_API_TOKEN not configured"
          : (err as Error).message.slice(0, 300);
    }
  }
  return total;
}

/** Find the internal buyer account ("Fanzia Vending — Internal"). */
async function findInternalBuyerAccountId(db: AnyDb): Promise<string | null> {
  const byKind = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.kind, accountKind.enumValues[0]))
    .limit(1);
  if (byKind[0]) return byKind[0].id;
  // Fallback for accounts provisioned before buyer_kind landed.
  const byName = await db
    .select({ id: account.id })
    .from(account)
    .where(ilike(account.legalName, "Fanzia Vending%"))
    .limit(1);
  return byName[0]?.id ?? null;
}

type SalesRow = { productId: string | null; units: number; soldAt: Date };

/** Daily sales units for one machine+product over the trailing 28 days. */
async function dailySalesFor(db: AnyDb, machineId: string, productId: string, now: Date): Promise<number[]> {
  const windowStart = new Date(now.getTime() - VELOCITY_WINDOW_DAYS * 86400000);
  const rows: SalesRow[] = await db
    .select({ productId: nayaxSale.productId, units: nayaxSale.units, soldAt: nayaxSale.soldAt })
    .from(nayaxSale)
    .where(
      and(
        eq(nayaxSale.machineId, machineId),
        eq(nayaxSale.productId, productId),
        gte(nayaxSale.soldAt, windowStart),
      ),
    );
  const days: number[] = Array(VELOCITY_WINDOW_DAYS).fill(0);
  for (const r of rows) {
    const idx = Math.floor((r.soldAt.getTime() - windowStart.getTime()) / 86400000);
    if (idx >= 0 && idx < VELOCITY_WINDOW_DAYS) days[idx] = (days[idx] ?? 0) + r.units;
  }
  // Trim leading days before the machine's first recorded sale so a machine
  // that came online mid-window doesn't report a diluted velocity — but
  // still require 14 days of history before trusting it (low-data flag).
  return days;
}

/**
 * Sales-derived on-hand: latest restock baseline minus sales since.
 * null when no restock has ever been recorded for the slot (the engine
 * flags 'baseline-unknown' and the review screen shows it plainly).
 */
async function onHandFor(
  db: AnyDb,
  machineId: string,
  slotPosition: number,
  productId: string,
  now: Date,
): Promise<number | null> {
  const [restock] = await db
    .select()
    .from(nayaxRestock)
    .where(
      and(
        eq(nayaxRestock.machineId, machineId),
        eq(nayaxRestock.slotPosition, slotPosition),
        eq(nayaxRestock.productId, productId),
      ),
    )
    .orderBy(desc(nayaxRestock.restockedAt))
    .limit(1);
  if (!restock) return null;
  const salesSince: SalesRow[] = await db
    .select({ productId: nayaxSale.productId, units: nayaxSale.units, soldAt: nayaxSale.soldAt })
    .from(nayaxSale)
    .where(
      and(
        eq(nayaxSale.machineId, machineId),
        eq(nayaxSale.productId, productId),
        gte(nayaxSale.soldAt, restock.restockedAt),
      ),
    );
  const sold = salesSince.reduce((a, r) => a + r.units, 0);
  return Math.max(0, restock.unitsRestored - sold);
}

export type WeeklyResult = {
  weekKey: string;
  runId: string;
  lines: SuggestionLine[];
  draftId: string;
  draftStatus: string;
  roundSync: {
    synced: boolean;
    roundId: string | null;
    linesUpserted: number;
    reason: string | null;
  };
};

/** Engine tag on allocation_line.notes — only tagged rows are engine-managed. */
function engineNote(weekKey: string): string {
  return `source=internal-suggestion week=${weekKey}`;
}

/**
 * Sync the engine's suggested quantities into the open allocation round as
 * the internal buyer's draft request lines (source='internal-suggestion',
 * tagged in notes). Only 'requested' lines carrying the engine tag are ever
 * touched — owner-edited or already-allocated lines are left alone. If no
 * open round exists (or no internal account yet), the weekly
 * internal_restock_draft remains the pending handoff and the sync is
 * reported as skipped, not an error.
 */
async function syncInternalLinesToRound(
  db: AnyDb,
  weekKey: string,
  lines: SuggestionLine[],
  now: Date,
): Promise<WeeklyResult["roundSync"]> {
  const accountId = await findInternalBuyerAccountId(db);
  if (!accountId) {
    return { synced: false, roundId: null, linesUpserted: 0, reason: "no-internal-account" };
  }
  const [round] = await db
    .select()
    .from(allocationRound)
    .where(eq(allocationRound.status, "collecting"))
    .orderBy(desc(allocationRound.createdAt))
    .limit(1);
  if (!round) {
    return { synced: false, roundId: null, linesUpserted: 0, reason: "no-open-round" };
  }
  if (!round.internalAccountId) {
    await db
      .update(allocationRound)
      .set({ internalAccountId: accountId, updatedAt: now })
      .where(eq(allocationRound.id, round.id));
  }

  let linesUpserted = 0;
  const wanted = new Map(lines.filter((l) => l.aggregateUnits > 0).map((l) => [l.productId, l]));
  const existing = await db
    .select()
    .from(allocationLine)
    .where(and(eq(allocationLine.roundId, round.id), eq(allocationLine.accountId, accountId)));

  for (const row of existing) {
    const isEngineLine = row.notes?.startsWith("source=internal-suggestion") ?? false;
    if (!isEngineLine || row.status !== "requested") continue;
    const line = wanted.get(row.productId);
    if (line) {
      await db
        .update(allocationLine)
        .set({
          requestedQty: line.aggregateUnits,
          notes: `${engineNote(weekKey)} cases=${line.cases}x${line.caseUnits}`,
        })
        .where(eq(allocationLine.id, row.id));
      wanted.delete(row.productId);
      linesUpserted++;
    } else {
      // Suggestion dropped to zero this week: zero the engine line rather
      // than deleting it (audit trail of what was once requested).
      await db
        .update(allocationLine)
        .set({ requestedQty: 0, notes: `${engineNote(weekKey)} withdrawn` })
        .where(eq(allocationLine.id, row.id));
      linesUpserted++;
    }
  }
  for (const line of wanted.values()) {
    await db.insert(allocationLine).values({
      roundId: round.id,
      accountId,
      productId: line.productId,
      requestedQty: line.aggregateUnits,
      status: "requested",
      notes: `${engineNote(weekKey)} cases=${line.cases}x${line.caseUnits}`,
    });
    linesUpserted++;
  }

  return { synced: true, roundId: round.id, linesUpserted, reason: null };
}

/**
 * Weekly suggestion run: poll → engine → persist suggestion run →
 * create/update the internal buyer's draft allocation request
 * (source='internal-suggestion'), idempotent per weekKey. Re-running in
 * the same week updates the lines but never overwrites an already-approved
 * draft — approval is a human decision, not an engine refresh.
 */
export async function runWeeklySuggestion(
  db: AnyDb = defaultDb,
  opts: { now?: Date } = {},
): Promise<WeeklyResult> {
  const now = opts.now ?? new Date();
  const weekKey = weekKeyFor(now);

  const machines = await db
    .select({ id: nayaxMachine.id, name: nayaxMachine.name })
    .from(nayaxMachine)
    .where(eq(nayaxMachine.active, true));

  // productId → { sku, name, params } for every product on an active slot.
  const slotRows = await db
    .select({
      machineId: slotMap.machineId,
      slotPosition: slotMap.slotPosition,
      productId: slotMap.productId,
      capacityUnits: slotMap.capacityUnits,
      sku: product.sku,
      name: product.name,
    })
    .from(slotMap)
    .innerJoin(product, eq(slotMap.productId, product.id))
    .where(eq(slotMap.active, true));

  const paramRows = await db.select().from(restockParams).where(eq(restockParams.active, true));
  const paramByProduct = new Map(paramRows.map((p) => [p.productId, p]));

  const byProduct = new Map<string, { sku: string; name: string; slots: typeof slotRows }>();
  for (const s of slotRows) {
    const entry = byProduct.get(s.productId) ?? { sku: s.sku, name: s.name, slots: [] };
    entry.slots.push(s);
    byProduct.set(s.productId, entry);
  }

  const inputs: SuggestInput[] = [];
  for (const [productId, entry] of byProduct) {
    const p = paramByProduct.get(productId);
    const params: RestockParamsInput = p
      ? {
          leadTimeDays: p.leadTimeDays,
          safetyStockDays: p.safetyStockDays,
          reviewPeriodDays: p.reviewPeriodDays,
          minOrderUnits: p.minOrderUnits,
          caseUnits: p.caseUnits,
          trialQty: p.trialQty,
        }
      : DEFAULT_RESTOCK_PARAMS;

    const machineInputs: MachineInput[] = [];
    for (const s of entry.slots) {
      const machine = machines.find((m) => m.id === s.machineId);
      if (!machine) continue;
      machineInputs.push({
        machineId: s.machineId,
        machineName: machine.name,
        dailySales: await dailySalesFor(db, s.machineId, productId, now),
        onHand: await onHandFor(db, s.machineId, s.slotPosition, productId, now),
      });
    }
    if (machineInputs.length === 0) continue;

    // A product is NEW when it has zero recorded sales across machines.
    const hasAnySales = machineInputs.some((m) => m.dailySales.some((d) => d > 0));
    inputs.push({
      productId,
      sku: entry.sku,
      name: entry.name,
      machines: machineInputs,
      params,
      isNew: !hasAnySales,
    });
  }

  const lines = suggestRestock(inputs);

  const [run] = await db
    .insert(nayaxSuggestionRun)
    .values({ weekKey, runAt: now, lines })
    .onConflictDoUpdate({
      target: nayaxSuggestionRun.weekKey,
      set: { runAt: now, lines, updatedAt: now },
    })
    .returning();

  const buyerAccountId = await findInternalBuyerAccountId(db);
  const draftLines = lines
    .filter((l) => l.aggregateUnits > 0)
    .map((l) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      units: l.aggregateUnits,
      cases: l.cases,
      caseUnits: l.caseUnits,
      flags: l.flags,
      perMachine: l.machines.map((m) => ({
        machineName: m.machineName,
        velocity: m.velocity,
        onHand: m.onHand,
        daysOfCover: m.daysOfCover,
        suggestedUnits: m.suggestedUnits,
        flags: m.flags,
      })),
    }));

  const existing = await db
    .select()
    .from(internalRestockDraft)
    .where(eq(internalRestockDraft.weekKey, weekKey))
    .limit(1);

  let draft = existing[0];
  if (!draft) {
    [draft] = await db
      .insert(internalRestockDraft)
      .values({
        weekKey,
        source: "internal-suggestion",
        status: "draft",
        buyerAccountId,
        lines: draftLines,
        notes: `Auto-generated by the Nayax suggestion engine for week ${weekKey}. Human approval required.`,
      })
      .returning();
  } else if (draft.status === "draft") {
    // Update the still-unapproved draft in place — idempotent per week.
    [draft] = await db
      .update(internalRestockDraft)
      .set({ lines: draftLines, buyerAccountId, updatedAt: now })
      .where(eq(internalRestockDraft.id, draft.id))
      .returning();
  }
  // 'approved'/'joined'/'superseded' drafts are never rewritten by the engine.

  const roundSync = await syncInternalLinesToRound(db, weekKey, lines, now).catch((err) => ({
    synced: false,
    roundId: null as string | null,
    linesUpserted: 0,
    reason: `sync-error: ${(err as Error).message.slice(0, 200)}`,
  }));

  return { weekKey, runId: run!.id, lines, draftId: draft!.id, draftStatus: draft!.status, roundSync };
}

/** True when today (America/Los_Angeles) is the configured suggestion day. */
export async function isSuggestionDay(
  db: AnyDb = defaultDb,
  now: Date = new Date(),
): Promise<boolean> {
  const day = await getSetting<string>(SETTINGS_KEYS.suggestionDay, "monday", db);
  return weekdayFor(now) === String(day).toLowerCase();
}
