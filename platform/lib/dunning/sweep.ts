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
 * CONTRACT (implemented by the dunning workstream).
 *
 * Day 3 → friendly reminder email; day 7 → firmer reminder + payment link;
 * day 14 → agent_proposal "account.hold" filed as the ai_operator system
 * user (falls back to a compliance_task for owner review if no ai_operator
 * user exists). Every send is deduped; a failed send is never logged so the
 * next run retries it (same pattern as the abandoned-draft sweep).
 */
export async function runDunningSweep(
  _db: AnyDb,
  _opts: OpsSweepOpts,
): Promise<{ day3Sent: number; day7Sent: number; day14Proposed: number }> {
  // STUB — replaced by the dunning workstream before the ops-sweep cron ships.
  return { day3Sent: 0, day7Sent: 0, day14Proposed: 0 };
}
