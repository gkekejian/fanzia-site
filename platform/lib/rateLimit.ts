import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Fixed-window rate limiter backed by Postgres (rate_limit_bucket,
 * migration 0028).
 *
 * The previous version kept buckets in a module-level Map. On Vercel every
 * concurrent request can land on a different function instance, and cold
 * starts wipe the Map, so the limits (magic-link requests, TOTP attempts,
 * application submits) were effectively unenforced. Postgres is already a
 * dependency, so this adds no vendor.
 *
 * One atomic upsert per check. If the database is unreachable the limiter
 * degrades to the old per-instance Map rather than failing the request.
 */
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function checkMemory(key: string, limit: number, windowMs: number, now: number): boolean {
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

async function resolveDb(db?: AnyDb): Promise<AnyDb> {
  if (db) return db;
  const mod = await import("@/db/client");
  return mod.db as unknown as AnyDb;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number, db?: AnyDb): Promise<boolean> {
  const now = Date.now();
  try {
    const handle = await resolveDb(db);
    const nowTs = new Date(now).toISOString();
    const resetTs = new Date(now + windowMs).toISOString();
    const result = (await handle.execute(sql`
      INSERT INTO rate_limit_bucket (key, count, reset_at)
      VALUES (${key}, 1, ${resetTs}::timestamptz)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_bucket.reset_at <= ${nowTs}::timestamptz
                     THEN 1 ELSE rate_limit_bucket.count + 1 END,
        reset_at = CASE WHEN rate_limit_bucket.reset_at <= ${nowTs}::timestamptz
                        THEN EXCLUDED.reset_at ELSE rate_limit_bucket.reset_at END
      RETURNING count
    `)) as unknown as { rows: { count: number | string }[] };
    // Opportunistic cleanup so the table never needs a cron.
    if (Math.random() < 0.01) {
      await handle.execute(sql`DELETE FROM rate_limit_bucket WHERE reset_at < ${nowTs}::timestamptz`);
    }
    return Number(result.rows[0]?.count ?? 1) <= limit;
  } catch (err) {
    console.warn("[rateLimit] database limiter unavailable, using per-instance fallback:", (err as Error).message);
    return checkMemory(key, limit, windowMs, now);
  }
}

/**
 * Vercel sets x-real-ip to the connecting client and overwrites
 * x-forwarded-for; prefer x-real-ip, fall back to the first XFF hop.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Presets for the public write endpoints. Keys should be scoped per
 * endpoint AND per identity (IP for anonymous traffic, buyer account id
 * for authed).
 */
export const PUBLIC_WRITE_LIMITS = {
  /** Wholesale application submit: ~10 applications/hour per IP. */
  applicationSubmit: { limit: 10, windowMs: HOUR_MS },
  /** Order-request placement: ~30 submits/hour per buyer account + IP. */
  draftRequestSubmit: { limit: 30, windowMs: HOUR_MS },
  /** Contact-message ingest from the marketing site: 10/10min/IP. */
  contactIngest: { limit: 10, windowMs: 10 * 60 * 1000 },
} as const;

/**
 * Returns a 429 NextResponse when the bucket is exhausted, or null when
 * the request may proceed:
 *
 *   const limited = await rateLimited(`apply:${ip}`, PUBLIC_WRITE_LIMITS.applicationSubmit);
 *   if (limited) return limited;
 */
export async function rateLimited(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  db?: AnyDb,
): Promise<NextResponse | null> {
  if (await checkRateLimit(key, limit, windowMs, db)) return null;
  return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
}
