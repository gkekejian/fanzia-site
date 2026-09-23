import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createTestDb } from "./testDb";
import {
  checkRateLimit,
  clientIp,
  rateLimited,
  PUBLIC_WRITE_LIMITS,
} from "@/lib/rateLimit";

describe("checkRateLimit (Postgres fixed window, shared across instances)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];
  beforeAll(async () => {
    ({ db } = await createTestDb());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit, then blocks within the window", async () => {
    const key = `test-basic:${Date.now()}`;
    expect(await checkRateLimit(key, 3, 60_000, db)).toBe(true);
    expect(await checkRateLimit(key, 3, 60_000, db)).toBe(true);
    expect(await checkRateLimit(key, 3, 60_000, db)).toBe(true);
    expect(await checkRateLimit(key, 3, 60_000, db)).toBe(false);
    expect(await checkRateLimit(key, 3, 60_000, db)).toBe(false);
  });

  it("resets the bucket after the window expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = `test-reset:${Date.now()}`;
    expect(await checkRateLimit(key, 1, 60_000, db)).toBe(true);
    expect(await checkRateLimit(key, 1, 60_000, db)).toBe(false);
    vi.setSystemTime(Date.now() + 60_001);
    expect(await checkRateLimit(key, 1, 60_000, db)).toBe(true);
  });

  it("tracks keys independently", async () => {
    const a = `test-indep-a:${Date.now()}`;
    const b = `test-indep-b:${Date.now()}`;
    expect(await checkRateLimit(a, 1, 60_000, db)).toBe(true);
    expect(await checkRateLimit(a, 1, 60_000, db)).toBe(false);
    expect(await checkRateLimit(b, 1, 60_000, db)).toBe(true);
  });

  it("two limiter callers sharing one database share one bucket (the old Map did not)", async () => {
    const key = `test-shared:${Date.now()}`;
    const results = await Promise.all([1, 2, 3, 4].map(() => checkRateLimit(key, 2, 60_000, db)));
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});

describe("rateLimited helper", () => {
  it("returns null while under the limit and a 429 response once exceeded", async () => {
    const key = `test-helper:${Date.now()}`;
    const preset = { limit: 2, windowMs: 60_000 };
    const { db } = await createTestDb();
    expect(await rateLimited(key, preset, db)).toBeNull();
    expect(await rateLimited(key, preset, db)).toBeNull();
    const res = await rateLimited(key, preset, db);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    const body = await res!.json();
    expect(body.error).toMatch(/too many requests/i);
  });

  it("exposes the public-write presets with sensible free-tier defaults", () => {
    expect(PUBLIC_WRITE_LIMITS.applicationSubmit.limit).toBeLessThanOrEqual(10);
    expect(PUBLIC_WRITE_LIMITS.applicationSubmit.windowMs).toBe(3_600_000);
    expect(PUBLIC_WRITE_LIMITS.draftRequestSubmit.limit).toBeGreaterThan(0);
    expect(PUBLIC_WRITE_LIMITS.contactIngest.limit).toBe(10);
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(clientIp(headers)).toBe("9.9.9.9");
  });

  it("falls back to 'unknown' without the header", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
