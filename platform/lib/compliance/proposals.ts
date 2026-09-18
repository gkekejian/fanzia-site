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
 * Finds agent_proposals still pending after 24h and emails the owners a
 * single daily nudge per stale proposal (deduped). Stale approvals are the
 * #1 stall risk for two owners with day jobs — the queue must nag, not wait.
 */
export async function runProposalStalenessNudge(
  _db: AnyDb,
  _opts: OpsSweepOpts,
): Promise<{ nudged: number }> {
  // STUB — replaced by the compliance workstream before the ops-sweep cron ships.
  return { nudged: 0 };
}
