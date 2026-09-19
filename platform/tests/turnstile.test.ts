import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstile, turnstileFailureBody } from "@/lib/turnstile";

const SECRET = "test-secret-key";

function mockSiteverify(payload: unknown) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve(payload),
  });
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns ok:true when Cloudflare reports success", async () => {
    vi.stubGlobal("fetch", mockSiteverify({ success: true }));
    const result = await verifyTurnstile("client-token", "1.2.3.4");
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
  });

  it("posts secret, token, and remoteip to the siteverify endpoint", async () => {
    const fetchMock = mockSiteverify({ success: true });
    vi.stubGlobal("fetch", fetchMock);
    await verifyTurnstile("client-token", "1.2.3.4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("secret")).toBe(SECRET);
    expect(body.get("response")).toBe("client-token");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("returns ok:false with error codes when Cloudflare rejects the token", async () => {
    vi.stubGlobal("fetch", mockSiteverify({ success: false, "error-codes": ["invalid-input-response"] }));
    const result = await verifyTurnstile("bad-token");
    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(["invalid-input-response"]);
  });

  it("returns ok:false when the token is missing", async () => {
    const fetchMock = mockSiteverify({ success: true });
    vi.stubGlobal("fetch", fetchMock);
    expect((await verifyTurnstile(null)).ok).toBe(false);
    expect((await verifyTurnstile(undefined)).ok).toBe(false);
    expect((await verifyTurnstile("")).ok).toBe(false);
    // Cloudflare is never consulted without a token.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false when the siteverify request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const result = await verifyTurnstile("client-token");
    expect(result.ok).toBe(false);
  });

  it("fails OPEN with a warning when TURNSTILE_SECRET_KEY is unset", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockSiteverify({ success: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyTurnstile("client-token");
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(warn).toHaveBeenCalled();
    // No verification call is made without a secret.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes a stable 403 failure body", () => {
    expect(turnstileFailureBody()).toEqual({
      error: "Bot verification failed. Please complete the check and try again.",
    });
  });
});

describe("applicationSchema turnstileToken", () => {
  it("accepts a null token (widget absent or unsolved) so applicants are not blocked while Turnstile is off", async () => {
    const { applicationSchema } = await import("@/lib/validation/application");
    const base = {
      businessLegalName: "K & Jassy Shop LLC",
      channelType: "other",
      addressLine1: "1401 N Batavia St",
      city: "Orange",
      state: "CA",
      postalCode: "92867",
      contactName: "Kevin Sorto",
      contactEmail: "kjassyshop@gmail.com",
      termsAccepted: true,
    };
    expect(applicationSchema.safeParse({ ...base, turnstileToken: null }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...base, turnstileToken: "tok" }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...base }).success).toBe(true);
  });
});
