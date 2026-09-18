import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, accountContact, auditLog, orderRequest } from "@/db/schema";
import { runOpsSweep, type SweepEmail } from "@/lib/expiry/sweep";

// Companion sweeps are contract stubs owned by sibling workstreams — mock
// them so this suite tests the ops sweep's own wiring, not their behavior.
vi.mock("@/lib/dunning/sweep", () => ({
  runDunningSweep: vi.fn(async () => ({ day3Sent: 1, day7Sent: 2, day14Proposed: 3 })),
}));
vi.mock("@/lib/compliance/resaleDocs", () => ({
  runResaleDocSweep: vi.fn(async () => ({ remindersSent: 4, tasksCreated: 5 })),
}));
vi.mock("@/lib/compliance/proposals", () => ({
  runProposalStalenessNudge: vi.fn(async () => ({ nudged: 6 })),
}));
import { runDunningSweep } from "@/lib/dunning/sweep";
import { runResaleDocSweep } from "@/lib/compliance/resaleDocs";
import { runProposalStalenessNudge } from "@/lib/compliance/proposals";

// The cron route binds the real db client at module scope; point it at the
// per-test PGlite instance through a lazily-resolved mock.
vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __opsSweepTestDb?: unknown }).__opsSweepTestDb;
    if (!t) throw new Error("ops-sweep test db not set");
    return t;
  },
}));
import { GET } from "@/app/api/cron/ops-sweep/route";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

const ORIGINAL_SECRET = process.env.CRON_SECRET;
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  delete (globalThis as { __opsSweepTestDb?: unknown }).__opsSweepTestDb;
});

const uid = () => Math.random().toString(36).slice(2, 10);

async function seedAccount(db: TestDb) {
  const tag = uid();
  const [acct] = await db
    .insert(account)
    .values({
      legalName: `Test Buyer ${tag} LLC`,
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Pat Buyer",
      primaryContactEmail: `pat-${tag}@testbuyer.example`,
    })
    .returning();
  const [contact] = await db
    .insert(accountContact)
    .values({ accountId: acct!.id, name: "Pat Buyer", email: `pat-${tag}@testbuyer.example`, roleOnAccount: "primary" })
    .returning();
  return { accountId: acct!.id, contactId: contact!.id };
}

async function seedOffer(
  db: TestDb,
  seed: { accountId: string; contactId: string },
  overrides: Partial<{ expiresAt: Date; rolloverCount: number; status: string; subtotalMinor: number }> = {},
) {
  const [row] = await db
    .insert(orderRequest)
    .values({
      accountId: seed.accountId,
      contactId: seed.contactId,
      lines: [],
      subtotalMinor: overrides.subtotalMinor ?? 60000,
      smallOrderFeeMinor: 0,
      status: overrides.status ?? "submitted",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 3600 * 1000),
      rolloverCount: overrides.rolloverCount ?? 0,
    })
    .returning();
  return row!;
}

async function getOffer(db: TestDb, id: string) {
  const [row] = await db.select().from(orderRequest).where(eq(orderRequest.id, id));
  return row!;
}

function authed(secret: string | null) {
  const req = new NextRequest("http://localhost/api/cron/ops-sweep");
  if (secret !== null) req.headers.set("authorization", `Bearer ${secret}`);
  return req;
}

function sweepInput() {
  const sent: SweepEmail[] = [];
  return {
    sent,
    opts: {
      sendEmail: async (p: SweepEmail) => {
        sent.push(p);
        return { delivered: true };
      },
      baseUrl: "https://app.fanzia.io",
      now: new Date(),
    },
  };
}

const BANNED = /reserved|held|secured|guaranteed/i;

describe("ops-sweep cron auth", () => {
  it("401 without any Authorization header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await GET(authed(null));
    expect(res.status).toBe(401);
  });

  it("401 with the wrong secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await GET(authed("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("401 when no secret is configured at all", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(authed("anything"));
    expect(res.status).toBe(401);
  });
});

describe("ops sweep through the cron route", () => {
  let db: TestDb;
  beforeEach(async () => {
    ({ db } = await createTestDb());
    (globalThis as { __opsSweepTestDb?: unknown }).__opsSweepTestDb = db;
    vi.clearAllMocks();
  });

  it("expires, rolls over, nudges, and returns JSON counts", async () => {
    process.env.CRON_SECRET = "test-secret";
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 1000);

    const a = await seedAccount(db);
    const firstExpiry = await seedOffer(db, a, { expiresAt: past, rolloverCount: 0 });
    const b = await seedAccount(db);
    const secondExpiry = await seedOffer(db, b, { expiresAt: past, rolloverCount: 1 });
    const c = await seedAccount(db);
    const expiringSoon = await seedOffer(db, c, { expiresAt: new Date(now.getTime() + 23 * 3600 * 1000) });

    const res = await GET(authed("test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Exact JSON count shape the route contract promises.
    expect(body.rolledOver).toBe(1);
    expect(body.expired).toBe(1);
    expect(body.nudgesSent).toBe(1);
    expect(body.dunning).toEqual({ day3Sent: 1, day7Sent: 2, day14Proposed: 3 });
    expect(body.resaleDocs).toEqual({ remindersSent: 4, tasksCreated: 5 });
    expect(body.proposalNudges).toBe(6);

    // First expiry: silently rolled over — new expiry, budget consumed.
    const rolled = await getOffer(db, firstExpiry.id);
    expect(rolled.status).toBe("submitted");
    expect(rolled.rolloverCount).toBe(1);
    expect(rolled.expiresAt.getTime()).toBeGreaterThan(now.getTime());

    // Second expiry: final.
    const expired = await getOffer(db, secondExpiry.id);
    expect(expired.status).toBe("expired");

    // Nudge deduped via the timestamp column.
    const nudged = await getOffer(db, expiringSoon.id);
    expect(nudged.expiryNudgeSentAt).not.toBeNull();

    // Companion sweeps were called with exactly the contracted opts shape.
    for (const fn of [runDunningSweep, runResaleDocSweep, runProposalStalenessNudge]) {
      expect(fn).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(fn).mock.calls[0]![1];
      expect(typeof arg.sendEmail).toBe("function");
      expect(typeof arg.baseUrl).toBe("string");
      expect(arg.now).toBeInstanceOf(Date);
      expect(Object.keys(arg).sort()).toEqual(["baseUrl", "now", "sendEmail"]);
    }

    // The sweep run is audit-logged.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "ops_sweep.completed"), eq(auditLog.actorType, "system")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ rolledOver: 1, expired: 1, nudgesSent: 1 });
  });
});

describe("offer email content (sweep level)", () => {
  let db: TestDb;
  beforeEach(async () => {
    ({ db } = await createTestDb());
    vi.clearAllMocks();
  });

  it("final-expiry email carries the reaccept URL and the cancel-and-refund option", async () => {
    const seed = await seedAccount(db);
    const offer = await seedOffer(db, seed, { expiresAt: new Date(Date.now() - 60 * 1000), rolloverCount: 1 });
    const { sent, opts } = sweepInput();

    const result = await runOpsSweep(db, opts);
    expect(result.expired).toContain(offer.id);
    expect(result.finalExpirySent).toBe(1);

    const email = sent.find((e) => e.subject.includes("expired"));
    expect(email).toBeDefined();
    // Direct offer URL (reaccept link).
    expect(email!.text).toContain(`/member/order-requests/${offer.id}`);
    expect(email!.text).toMatch(/reaccept/i);
    // Cancel-and-refund option, honestly worded (no payment was taken).
    expect(email!.text).toMatch(/cancel/i);
    expect(email!.text).toMatch(/refund/i);
    // Copy hygiene.
    expect(email!.subject).not.toMatch(BANNED);
    expect(email!.text).not.toMatch(BANNED);
  });

  it("first rollover sends no buyer email from the sweep", async () => {
    const seed = await seedAccount(db);
    const offer = await seedOffer(db, seed, { expiresAt: new Date(Date.now() - 60 * 1000), rolloverCount: 0 });
    const { sent, opts } = sweepInput();

    const result = await runOpsSweep(db, opts);
    expect(result.rolledOver).toContain(offer.id);
    // Silent: no buyer email from the sweep for a first-expiry rollover.
    expect(sent).toHaveLength(0);
  });

  it("24h nudge is sent exactly once per expiry window", async () => {
    const seed = await seedAccount(db);
    const offer = await seedOffer(db, seed, { expiresAt: new Date(Date.now() + 23 * 3600 * 1000) });
    const { sent, opts } = sweepInput();

    const first = await runOpsSweep(db, opts);
    expect(first.nudgesSent).toBe(1);
    const second = await runOpsSweep(db, opts);
    expect(second.nudgesSent).toBe(0);
    expect(sent.filter((e) => e.subject.includes("expires tomorrow"))).toHaveLength(1);

    const nudged = sent.find((e) => e.subject.includes("expires tomorrow"))!;
    expect(nudged.text).toContain(`/member/order-requests/${offer.id}`);
    expect(nudged.text).toMatch(/automatic.*extension|extended/i);
    expect(nudged.subject).not.toMatch(BANNED);
    expect(nudged.text).not.toMatch(BANNED);
  });

  it("24h nudge copy differs for an already-rolled-over offer", async () => {
    const seed = await seedAccount(db);
    // Rollover budget spent but offer still live (e.g. re-extended manually): nudge says no more extensions.
    await seedOffer(db, seed, { expiresAt: new Date(Date.now() + 23 * 3600 * 1000), rolloverCount: 1 });
    const { sent, opts } = sweepInput();

    await runOpsSweep(db, opts);
    const nudged = sent.find((e) => e.subject.includes("expires tomorrow"))!;
    expect(nudged.text).toMatch(/can't be extended again/i);
    expect(nudged.text).toMatch(/reaccept/i);
  });

  it("a failed nudge send is not flagged, so the next run retries", async () => {
    const seed = await seedAccount(db);
    const offer = await seedOffer(db, seed, { expiresAt: new Date(Date.now() + 23 * 3600 * 1000) });
    const failing = {
      ...sweepInput().opts,
      sendEmail: async () => {
        throw new Error("SMTP down");
      },
    };

    const first = await runOpsSweep(db, failing);
    expect(first.nudgesSent).toBe(0);
    // Not flagged → still eligible.
    expect((await getOffer(db, offer.id)).expiryNudgeSentAt).toBeNull();

    const { sent, opts } = sweepInput();
    const second = await runOpsSweep(db, opts);
    expect(second.nudgesSent).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await getOffer(db, offer.id)).expiryNudgeSentAt).not.toBeNull();
  });

  it("offers far from expiry are not nudged", async () => {
    const seed = await seedAccount(db);
    await seedOffer(db, seed, { expiresAt: new Date(Date.now() + 40 * 3600 * 1000) });
    const { sent, opts } = sweepInput();

    const result = await runOpsSweep(db, opts);
    expect(result.nudgesSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("an already-expired offer is not re-emailed on the next sweep", async () => {
    const seed = await seedAccount(db);
    const offer = await seedOffer(db, seed, { expiresAt: new Date(Date.now() - 60 * 1000), rolloverCount: 1 });
    const firstInput = sweepInput();
    const first = await runOpsSweep(db, firstInput.opts);
    expect(first.expired).toContain(offer.id);
    expect(first.finalExpirySent).toBe(1);

    // Next run: the offer is no longer submitted, so it can't expire again.
    const secondInput = sweepInput();
    const second = await runOpsSweep(db, secondInput.opts);
    expect(second.expired).toHaveLength(0);
    expect(second.finalExpirySent).toBe(0);
    expect(secondInput.sent).toHaveLength(0);
  });
});
