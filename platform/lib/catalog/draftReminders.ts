import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, gt } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { account, draftRequest, draftReminderLog, orderRequest } from "@/db/schema";
import { getMemberCatalog } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const ABANDONED_DRAFT_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

type DraftLike = {
  lines: unknown;
  updatedAt: Date;
};

type ReminderLogLike = {
  draftUpdatedAt: Date;
} | null;

/**
 * Pure abandonment check, kept free of I/O so the rule is unit-testable.
 * A draft is abandoned when ALL of these hold:
 * - it has at least one line (an empty draft is not abandoned, it's new),
 * - it was last touched more than 24h ago,
 * - no order_request was created after the draft's updatedAt (the buyer
 *   may have submitted from a different session — the draft row is only
 *   cleared on submit, so a newer order request means "not abandoned"),
 * - no reminder was already sent for this exact draft version (a draft
 *   edited after a reminder gets a new updatedAt and becomes eligible
 *   again; the same version is never reminded twice).
 */
export function isDraftAbandoned(
  draft: DraftLike | null,
  orderRequestsAfterDraft: number,
  reminderLog: ReminderLogLike,
  now: Date = new Date(),
): boolean {
  if (!draft) return false;
  const lines = (draft.lines ?? []) as unknown[];
  if (lines.length === 0) return false;
  if (draft.updatedAt.getTime() >= now.getTime() - ABANDONED_DRAFT_AFTER_MS) return false;
  if (orderRequestsAfterDraft > 0) return false;
  if (reminderLog && reminderLog.draftUpdatedAt.getTime() === draft.updatedAt.getTime()) return false;
  return true;
}

export type AbandonedDraft = {
  accountId: string;
  primaryContactEmail: string;
  primaryContactName: string;
  draftId: string;
  draftUpdatedAt: Date;
  lines: { productId: string; qtyRequested: number }[];
};

/**
 * Finds abandoned drafts across all accounts. Draft rows whose lines are
 * empty are skipped in JS (jsonb filtering is not portable between the
 * PGlite test DB and production Postgres for this shape).
 */
export async function findAbandonedDrafts(
  db: AnyDb = defaultDb,
  now: Date = new Date(),
): Promise<{ checked: number; abandoned: AbandonedDraft[] }> {
  const drafts = await db.select().from(draftRequest);
  const abandoned: AbandonedDraft[] = [];
  let checked = 0;

  for (const draft of drafts) {
    const lines = (draft.lines ?? []) as { productId: string; qtyRequested: number }[];
    if (lines.length === 0) continue;
    checked++;

    const newerOrders = await db
      .select({ id: orderRequest.id })
      .from(orderRequest)
      .where(and(eq(orderRequest.accountId, draft.accountId), gt(orderRequest.createdAt, draft.updatedAt)))
      .limit(1);

    const [log] = await db
      .select()
      .from(draftReminderLog)
      .where(eq(draftReminderLog.accountId, draft.accountId))
      .limit(1);

    if (!isDraftAbandoned(draft, newerOrders.length, log ?? null, now)) continue;

    const [acct] = await db.select().from(account).where(eq(account.id, draft.accountId)).limit(1);
    if (!acct) continue;

    abandoned.push({
      accountId: draft.accountId,
      primaryContactEmail: acct.primaryContactEmail,
      primaryContactName: acct.primaryContactName,
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt,
      lines,
    });
  }

  return { checked, abandoned };
}

/** Records that a reminder was sent for a draft version (upsert per account). */
export async function logDraftReminder(accountId: string, draftUpdatedAt: Date, db: AnyDb = defaultDb) {
  await db
    .insert(draftReminderLog)
    .values({ accountId, draftUpdatedAt })
    .onConflictDoUpdate({
      target: draftReminderLog.accountId,
      set: { draftUpdatedAt, sentAt: new Date() },
    });
}

/**
 * The sweep itself, minus auth — the cron route (app/api/cron/…) handles
 * the Bearer check and calls this. Kept in lib so tests can run it against
 * a scratch DB without HTTP.
 */
export async function runAbandonedDraftSweep(
  input: {
    sendEmail: (params: { to: string; subject: string; text: string; listName: string }) => Promise<unknown>;
    resumeUrl: string;
    formatMoney: (minor: number) => string;
    draftReminderBody: (params: {
      contactName: string;
      units: number;
      products: number;
      subtotalMinor: number;
      marginTotalMinor: number | null;
      resumeUrl: string;
      formatMoney: (minor: number) => string;
      namedLines?: { name: string; qty: number }[];
    }) => string;
  },
  db: AnyDb = defaultDb,
  now: Date = new Date(),
): Promise<{ checked: number; reminded: number; failed: number }> {
  const { checked, abandoned } = await findAbandonedDrafts(db, now);
  const catalog = await getMemberCatalog(db);
  const priceById = new Map(catalog.map((p) => [p.id, p]));

  let reminded = 0;
  let failed = 0;

  for (const draft of abandoned) {
    let units = 0;
    let subtotalMinor = 0;
    let marginTotalMinor = 0;
    let marginKnown = false;
    const products = new Set<string>();
    const namedByQty: { name: string; qty: number }[] = [];

    for (const line of draft.lines) {
      const p = priceById.get(line.productId);
      if (!p || !(line.qtyRequested > 0)) continue;
      products.add(line.productId);
      units += line.qtyRequested;
      subtotalMinor += line.qtyRequested * p.priceMinor;
      namedByQty.push({ name: p.name, qty: line.qtyRequested });
      if (p.marginMinor !== null) {
        marginKnown = true;
        marginTotalMinor += line.qtyRequested * p.marginMinor;
      }
    }

    // Every line references a product that left the catalog — nothing
    // meaningful to remind about; skip without logging so a future
    // re-listed product can still trigger a reminder.
    if (products.size === 0) continue;

    // Name the sets in the reminder ("3× Prismatic Evolutions Booster
    // Box…") — naming contents beats generic "come back" copy.
    namedByQty.sort((a, b) => b.qty - a.qty);
    const namedLines = namedByQty.slice(0, 4);

    try {
      await input.sendEmail({
        to: draft.primaryContactEmail,
        subject: "Your Fanzia draft is still waiting",
        listName: "abandoned-draft-reminders",
        text: input.draftReminderBody({
          contactName: draft.primaryContactName,
          units,
          products: products.size,
          subtotalMinor,
          marginTotalMinor: marginKnown ? marginTotalMinor : null,
          resumeUrl: input.resumeUrl,
          formatMoney: input.formatMoney,
          namedLines,
        }),
      });
      await logDraftReminder(draft.accountId, draft.draftUpdatedAt, db);
      reminded++;
    } catch (err) {
      console.error("[abandoned-drafts] send failed", draft.accountId, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  return { checked, reminded, failed };
}
