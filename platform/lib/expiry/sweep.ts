import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { account, orderRequest } from "@/db/schema";
import { processExpiredOffers } from "@/lib/invoicing/service";
import { getSetting } from "@/lib/settings";
import { runDunningSweep } from "@/lib/dunning/sweep";
import { runResaleDocSweep } from "@/lib/compliance/resaleDocs";
import { runProposalStalenessNudge } from "@/lib/compliance/proposals";
import { finalExpiryEmail, preExpiryNudgeEmail } from "@/lib/email/offerEmails";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export interface SweepEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface RunOpsSweepOpts {
  sendEmail: (params: SweepEmail) => Promise<unknown>;
  baseUrl: string;
  now: Date;
}

export interface OpsSweepResult {
  /** IDs of offers that expired on this run and were silently rolled over (first expiry — no buyer email). */
  rolledOver: string[];
  /** IDs of offers that hit final expiry on this run (buyer emailed reaccept-or-cancel). */
  expired: string[];
  /** Final-expiry buyer emails successfully sent on this run. */
  finalExpirySent: number;
  /** 24h pre-expiry nudges successfully sent on this run. */
  nudgesSent: number;
  dunning: { day3Sent: number; day7Sent: number; day14Proposed: number };
  resaleDocs: { remindersSent: number; tasksCreated: number };
  proposalNudges: number;
}

/** Offers expiring within this window get the one "expires tomorrow" nudge. */
const PRE_EXPIRY_NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Batch cap mirroring processExpiredOffers' own limit. */
const SWEEP_LIMIT = 500;

function offerUrl(baseUrl: string, requestId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/member/order-requests/${requestId}`;
}

/** The account's primary contact email for buyer-facing offer notifications (null when unknown). */
async function buyerEmailFor(db: AnyDb, accountId: string): Promise<string | null> {
  const [acct] = await db
    .select({ email: account.primaryContactEmail })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1);
  return acct?.email ?? null;
}

function offerTotalMinor(req: { subtotalMinor: number; smallOrderFeeMinor: number | null }): number {
  return req.subtotalMinor + (req.smallOrderFeeMinor ?? 0);
}

/**
 * The daily ops sweep (Vercel cron /api/cron/ops-sweep, 6:30 AM PT; also
 * reused by the owner-triggered POST /api/admin/order-requests/process-expiry).
 *
 *  1. Runs every stale submitted offer through the rollover policy via
 *     processExpiredOffers. First expiry = silent automatic rollover — the
 *     sweep deliberately sends NO buyer email for these (policy: max 1
 *     automatic free rollover, no buyer action needed).
 *  2. For offers that hit FINAL expiry on this run: sends the buyer the
 *     reaccept-or-cancel email (direct offer URL + cancel-and-refund option).
 *  3. Sends the 24h pre-expiry nudge to submitted offers expiring within a
 *     day that were never nudged for their current expiry window, deduped
 *     via order_request.expiry_nudge_sent_at (set only after a successful
 *     send, so a failed send retries on the next run instead of being
 *     skipped forever).
 *  4. Runs the dunning, resale-doc, and proposal-staleness companion sweeps.
 *
 * Emails are best-effort by design: the underlying actions (expiry,
 * rollover) already happened, so a failed send is logged loudly and the
 * sweep continues rather than aborting. Every call is testable through the
 * injected sendEmail / now / db — the route only wires real dependencies.
 */
export async function runOpsSweep(db: AnyDb, opts: RunOpsSweepOpts): Promise<OpsSweepResult> {
  const { sendEmail, baseUrl, now } = opts;
  const expiryHours = await getSetting<number>("commerce.offer_expiry_hours", 48, db);

  // (1) Expire stale offers through the rollover policy.
  const { rolledOver, expired } = await processExpiredOffers(db, { now });

  // (2) Final-expiry buyer emails — only for offers that expired on THIS run.
  // (Transitioning to expired is itself the dedupe: an offer appears here once.)
  let finalExpirySent = 0;
  for (const id of expired) {
    const [req] = await db.select().from(orderRequest).where(eq(orderRequest.id, id)).limit(1);
    if (!req) continue;
    const to = await buyerEmailFor(db, req.accountId);
    if (!to) continue; // no buyer contact on file; owners were already notified by the service
    try {
      await sendEmail(
        finalExpiryEmail({
          to,
          totalMinor: offerTotalMinor(req),
          offerUrl: offerUrl(baseUrl, req.id),
          expiryHours,
        }),
      );
      finalExpirySent++;
    } catch (err) {
      console.error(
        "[ops-sweep:email-failed]",
        "offer.expired_final",
        req.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // (3) 24h pre-expiry nudges, deduped per expiry window.
  let nudgesSent = 0;
  const nudgeCutoff = new Date(now.getTime() + PRE_EXPIRY_NUDGE_WINDOW_MS);
  const candidates = await db
    .select()
    .from(orderRequest)
    .where(
      and(
        eq(orderRequest.status, "submitted"),
        gt(orderRequest.expiresAt, now),
        lte(orderRequest.expiresAt, nudgeCutoff),
        isNull(orderRequest.expiryNudgeSentAt),
      ),
    )
    .limit(SWEEP_LIMIT);
  for (const req of candidates) {
    const to = await buyerEmailFor(db, req.accountId);
    if (!to) continue;
    try {
      await sendEmail(
        preExpiryNudgeEmail({
          to,
          totalMinor: offerTotalMinor(req),
          offerUrl: offerUrl(baseUrl, req.id),
          expiresAt: req.expiresAt,
          rolloversUsed: req.rolloverCount ?? 0,
          expiryHours,
        }),
      );
      // Mark only after a successful send: a failure leaves the flag NULL so
      // the next sweep retries this offer instead of skipping it forever.
      await db.update(orderRequest).set({ expiryNudgeSentAt: now }).where(eq(orderRequest.id, req.id));
      nudgesSent++;
    } catch (err) {
      console.error(
        "[ops-sweep:email-failed]",
        "offer.expires_soon",
        req.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // (4) Companion sweeps (contract stubs today; sibling workstreams own them).
  const dunning = await runDunningSweep(db, { sendEmail, baseUrl, now });
  const resaleDocs = await runResaleDocSweep(db, { sendEmail, baseUrl, now });
  const proposalNudges = (await runProposalStalenessNudge(db, { sendEmail, baseUrl, now })).nudged;

  return { rolledOver, expired, finalExpirySent, nudgesSent, dunning, resaleDocs, proposalNudges };
}
