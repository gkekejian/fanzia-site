import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { sendNotificationEmail } from "@/lib/email/send";
import { runOpsSweep } from "@/lib/expiry/sweep";
import { isSuggestionDay, runNayaxPoll, runWeeklySuggestion } from "@/lib/nayax/weekly";

/**
 * Daily ops sweep. Runs on Vercel Cron (vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET` automatically when the CRON_SECRET
 * env var is set on the project. Without a matching secret the route
 * answers 401 and does nothing.
 *
 * Each run: (1) expires stale submitted offers through the rollover policy
 * (first expiry = one silent automatic rollover, no buyer email; later
 * expiry = buyer emailed reaccept-or-cancel with the direct offer URL),
 * (2) sends the 24h pre-expiry nudge once per offer per expiry window,
 * (3) runs the dunning, resale-doc, and proposal-staleness companion sweeps,
 * (4) polls Nayax for vending sales (all active machines, idempotent
 * ingest), and (5) on the configured suggestion day only (settings key
 * `suggestion_day`, default Monday, America/Los_Angeles) runs the restock
 * suggestion engine and (re)builds the internal buyer's draft request.
 *
 * Nayax note: Vercel Hobby cron is daily at most, so the 15-minute polling
 * the design doc wants for lastSales is impossible here — the daily poll
 * plus the manual CSV import route (app/api/admin/nayax/import) covers v1.
 * Real-time would need the SQS stream (brief §4), out of scope for v1.
 *
 * Emails are best-effort (sendNotificationEmail never throws) so a failed
 * send can't abort the sweep. Nayax failures are likewise contained: a
 * failed poll or suggestion run is reported in the response + audit log and
 * never aborts the expiry work. The run is audit-logged as one system entry.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runOpsSweep(db, {
    sendEmail: (params) => sendNotificationEmail(params, "ops-sweep"),
    baseUrl: process.env.APP_BASE_URL ?? "https://app.fanzia.io",
    now: new Date(),
  });

  // Nayax vending sales poll + weekly suggestion. Contained in try/catch so
  // a connector outage can never break the expiry/dunning/resale-doc work.
  let nayax: {
    configured: boolean;
    machines: number;
    inserted: number;
    skipped: number;
    quarantined: number;
    error: string | null;
  } | null = null;
  let suggestion: {
    weekKey: string;
    draftId: string;
    draftStatus: string;
    roundSynced?: boolean;
    error?: string;
  } | null = null;
  try {
    nayax = await runNayaxPoll(db);
    if (await isSuggestionDay(db, new Date())) {
      const weekly = await runWeeklySuggestion(db);
      suggestion = {
        weekKey: weekly.weekKey,
        draftId: weekly.draftId,
        draftStatus: weekly.draftStatus,
        roundSynced: weekly.roundSync.synced,
      };
    }
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    if (!nayax) {
      nayax = { configured: false, machines: 0, inserted: 0, skipped: 0, quarantined: 0, error: message };
    } else {
      nayax.error = message;
    }
    suggestion = { weekKey: "", draftId: "", draftStatus: "", error: message };
  }

  await recordAudit(
    {
      actorType: "system",
      action: "ops_sweep.completed",
      entityType: "ops_sweep",
      after: {
        rolledOver: result.rolledOver.length,
        expired: result.expired.length,
        finalExpirySent: result.finalExpirySent,
        nudgesSent: result.nudgesSent,
        dunning: result.dunning,
        resaleDocs: result.resaleDocs,
        proposalNudges: result.proposalNudges,
        nayax,
        suggestion,
      },
    },
    db,
  );

  return NextResponse.json({
    rolledOver: result.rolledOver.length,
    expired: result.expired.length,
    nudgesSent: result.nudgesSent,
    dunning: result.dunning,
    resaleDocs: result.resaleDocs,
    proposalNudges: result.proposalNudges,
    nayax,
    suggestion,
  });
}
