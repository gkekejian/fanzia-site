import { NextResponse } from "next/server";

/**
 * In-memory fixed-window rate limiter. Sufficient for a single-instance
 * MVP deployment; if the platform ever runs multi-instance, replace the
 * Map with a shared store (Redis/Upstash) — the call sites don't change.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Presets for the public write endpoints (free-tier friendly: in-memory,
 * no external service). Keys should be scoped per endpoint AND per
 * identity (IP for anonymous traffic, buyer account id for authed).
 */
export const PUBLIC_WRITE_LIMITS = {
  /** Wholesale application submit: ~10 applications/hour per IP. */
  applicationSubmit: { limit: 10, windowMs: HOUR_MS },
  /** Order-request placement: ~30 submits/hour per buyer account + IP. */
  draftRequestSubmit: { limit: 30, windowMs: HOUR_MS },
  /** Contact-message ingest from the marketing site: unchanged, 10/10min/IP. */
  contactIngest: { limit: 10, windowMs: 10 * 60 * 1000 },
} as const;

/**
 * Convenience wrapper: returns a 429 NextResponse when the bucket is
 * exhausted, or null when the request may proceed. Usage:
 *
 *   const limited = rateLimited(`apply:${ip}`, PUBLIC_WRITE_LIMITS.applicationSubmit);
 *   if (limited) return limited;
 */
export function rateLimited(key: string, { limit, windowMs }: { limit: number; windowMs: number }) {
  if (checkRateLimit(key, limit, windowMs)) return null;
  return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
}
