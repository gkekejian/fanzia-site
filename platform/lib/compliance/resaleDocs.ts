import type { PgDatabase } from "drizzle-orm/pg-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export interface OpsSweepEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface OpsSweepOpts {
  sendEmail: (params: OpsSweepEmail) => Promise<unknown>;
  baseUrl: string;
  now: Date;
}

/**
 * CONTRACT (implemented by the compliance workstream).
 *
 * Backfills `compliance_task` rows (kind `resale_doc_expiry`) for approved
 * accounts whose resale docs have no tracking task, then sends 90/60/30-day
 * renewal reminder emails where an expiry date is known. Never flips
 * tax_status — a lapsed doc surfaces as a task and the flip goes through
 * the normal `application.tax_determine` proposal path.
 */
export async function runResaleDocSweep(
  _db: AnyDb,
  _opts: OpsSweepOpts,
): Promise<{ remindersSent: number; tasksCreated: number }> {
  // STUB — replaced by the compliance workstream before the ops-sweep cron ships.
  return { remindersSent: 0, tasksCreated: 0 };
}
