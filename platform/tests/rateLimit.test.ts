import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  clientIp,
  rateLimited,
  PUBLIC_WRITE_LIMITS,
} from "@/lib/rateLimit";

describe("checkRateLimit (fixed window)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit, then blocks within the window", () => {
    const key = `test-basic:${Date.now()}`;
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(false);
    expect(checkRateLimit(key, 3, 60_000)).toBe(false);
  });

  it("resets the bucket after the window expires", () => {
    const key = `test-reset:${Date.now()}`;
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);
    expect(checkRateLimit(key, 1, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);
  });

  it("tracks keys independently", () => {
    const a = `test-indep-a:${Date.now()}`;
    const b = `test-indep-b:${Date.now()}`;
    expect(checkRateLimit(a, 1, 60_000)).toBe(true);
    expect(checkRateLimit(a, 1, 60_000)).toBe(false);
    expect(checkRateLimit(b, 1, 60_000)).toBe(true);
  });
});

describe("rateLimited helper", () => {
  it("returns null while under the limit and a 429 response once exceeded", async () => {
    const key = `test-helper:${Date.now()}`;
    const preset = { limit: 2, windowMs: 60_000 };
    expect(await rateLimited(key, preset)).toBeNull();
    expect(await rateLimited(key, preset)).toBeNull();
    const res = await rateLimited(key, preset);
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
