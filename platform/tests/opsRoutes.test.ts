/**
 * Route-level tests for the owner console endpoints added in the second
 * review pass: settings, module guards, Today, analytics, refunds, holds,
 * paid-order sync, and the public uptime endpoint.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "@/db/schema";
import { createTestDb } from "./testDb";
import { account, allocationRound, auditLog, refundDue, invoice, supplier, user as userTable } from "@/db/schema";

vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __opsRoutesDb?: unknown }).__opsRoutesDb;
    if (!t) throw new Error("ops-routes test db not set");
    return t;
  },
}));
vi.mock("@/lib/auth/actor", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/email/send", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
  sendTransactionalEmail: vi.fn(async () => ({ delivered: true })),
}));

import { requireActor } from "@/lib/auth/actor";
import { GET as getSettings, POST as postSettings } from "@/app/api/admin/settings/route";
import { GET as getPriceIntel } from "@/app/api/admin/price-intel/route";
import { GET as getToday } from "@/app/api/admin/today/route";
import { GET as getAnalytics } from "@/app/api/admin/analytics/route";
import { POST as resolveRefund } from "@/app/api/admin/refunds/[id]/resolve/route";
import { POST as setHold } from "@/app/api/admin/accounts/[id]/hold/route";
import { POST as syncPaid } from "@/app/api/admin/allocation-rounds/[id]/sync-paid/route";
import { GET as publicHealthRoute } from "@/app/api/public/health/route";
import { GET as navState } from "@/app/api/admin/nav-state/route";
import { POST as provisionInternal } from "@/app/api/admin/internal-buyer/route";
import { accountContact } from "@/db/schema";
import { canOrder, normalizeContactRole } from "@/lib/users/contactRoles";

type TestDb = PgliteDatabase<typeof schema>;
const db = () => (globalThis as { __opsRoutesDb?: unknown }).__opsRoutesDb as TestDb;

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const owner = { kind: "owner", user: { id: OWNER_ID, name: "Owner", email: "owner@example.com", role: "owner", mfaEnrolled: true } };
const agent = { kind: "ai_operator", agent: { id: "a", name: "Muse", email: "m@x", role: "ai_operator", scopes: [], apiKeyId: "k" } };

const req = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(async () => {
  const { db: fresh } = await createTestDb();
  (globalThis as { __opsRoutesDb?: unknown }).__opsRoutesDb = fresh;
  await fresh.insert(userTable).values({ id: OWNER_ID, email: "owner@example.com", name: "Owner", role: "owner" });
  vi.mocked(requireActor).mockReset().mockResolvedValue(owner as never);
});

describe("settings route", () => {
  it("returns definitions and values to owners only", async () => {
    const res = await getSettings(req("/api/admin/settings"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definitions.length).toBeGreaterThan(10);
    expect(body.values.order_minimum_minor).toBe(50000);

    vi.mocked(requireActor).mockResolvedValue(agent as never);
    expect((await getSettings(req("/api/admin/settings"))).status).toBe(403);
  });

  it("validates, saves, and audits only the keys that changed", async () => {
    const bad = await postSettings(req("/api/admin/settings", { changes: { offer_expiry_hours: 2 } }));
    expect(bad.status).toBe(400);

    const ok = await postSettings(req("/api/admin/settings", { changes: { order_minimum_minor: 40000, ordering_paused: false } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.changed).toEqual(["order_minimum_minor"]);
    const audits = await db().select().from(auditLog).where(eq(auditLog.action, "settings.updated"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toEqual({ order_minimum_minor: 50000 });
    expect(audits[0]!.after).toEqual({ order_minimum_minor: 40000 });
  });

  it("rejects an empty body", async () => {
    expect((await postSettings(req("/api/admin/settings", {}))).status).toBe(400);
  });
});

describe("module guards", () => {
  it("a disabled module's API answers 404 until it is switched on", async () => {
    const off = await getPriceIntel(req("/api/admin/price-intel"));
    expect(off.status).toBe(404);
    expect((await off.json()).error).toBe("module_disabled");
    await postSettings(req("/api/admin/settings", { changes: { module_price_intel: true } }));
    const on = await getPriceIntel(req("/api/admin/price-intel"));
    expect(on.status).not.toBe(404);
  });

  it("nav-state reports module flags and queue size", async () => {
    const res = await navState(req("/api/admin/nav-state"));
    const body = await res.json();
    expect(body.modules).toMatchObject({ module_price_intel: false, module_vending: true });
    expect(typeof body.todayCount).toBe("number");
  });
});

describe("today + analytics routes", () => {
  it("are owner-only and return data", async () => {
    expect((await getToday(req("/api/admin/today"))).status).toBe(200);
    const a = await getAnalytics(req("/api/admin/analytics?days=7"));
    expect(a.status).toBe(200);
    expect((await a.json()).window.days).toBe(7);
    vi.mocked(requireActor).mockResolvedValue(agent as never);
    expect((await getToday(req("/api/admin/today"))).status).toBe(403);
    expect((await getAnalytics(req("/api/admin/analytics"))).status).toBe(403);
  });

  it("a non-owner session is refused by requireActor itself", async () => {
    vi.mocked(requireActor).mockResolvedValue(NextResponse.json({ error: "mfa_enrollment_required" }, { status: 403 }) as never);
    expect((await getToday(req("/api/admin/today"))).status).toBe(403);
  });
});

describe("refunds, holds, paid-order sync", () => {
  async function seed() {
    const [a] = await db()
      .insert(account)
      .values({ legalName: "Acme", channelType: "other", addressLine1: "1", city: "LA", state: "CA", postalCode: "90001", primaryContactName: "P", primaryContactEmail: "p@x.co" })
      .returning();
    const [inv] = await db()
      .insert(invoice)
      .values({ invoiceNumber: "FZ-R-1", accountId: a!.id, lines: [], subtotalMinor: 1000, smallOrderFeeMinor: 0, taxMinor: 0, totalMinor: 1000, status: "paid" })
      .returning();
    return { a: a!, inv: inv! };
  }

  it("resolve: validates method, resolves once, audits", async () => {
    const { a, inv } = await seed();
    const [r] = await db().insert(refundDue).values({ invoiceId: inv.id, accountId: a.id, amountMinor: 500, reason: "x" }).returning();
    expect((await resolveRefund(req(`/x`, { method: "bitcoin" }), { params: { id: r!.id } })).status).toBe(400);
    expect((await resolveRefund(req(`/x`, { method: "ach" }), { params: { id: r!.id } })).status).toBe(200);
    expect((await resolveRefund(req(`/x`, { method: "ach" }), { params: { id: r!.id } })).status).toBe(404);
    const [after] = await db().select().from(refundDue).where(eq(refundDue.id, r!.id));
    expect(after).toMatchObject({ status: "refunded", method: "ach", resolvedBy: OWNER_ID });
  });

  it("hold: requires a reason to place, lifts cleanly, audits both", async () => {
    const { a } = await seed();
    expect((await setHold(req("/x", { hold: true }), { params: { id: a.id } })).status).toBe(400);
    expect((await setHold(req("/x", { hold: true, reason: "Unpaid 60 days" }), { params: { id: a.id } })).status).toBe(200);
    expect((await db().select().from(account).where(eq(account.id, a.id)))[0]!.orderingHoldReason).toBe("Unpaid 60 days");
    expect((await setHold(req("/x", { hold: false }), { params: { id: a.id } })).status).toBe(200);
    expect((await db().select().from(account).where(eq(account.id, a.id)))[0]!.orderingHoldReason).toBeNull();
    const audits = await db().select().from(auditLog).where(eq(auditLog.entityId, a.id));
    expect(audits.map((x) => x.action).sort()).toEqual(["account.hold_lifted", "account.hold_placed"]);
  });

  it("sync-paid refuses a round that is not collecting", async () => {
    const [s] = await db().insert(supplier).values({ name: "S" }).returning();
    const [round] = await db().insert(allocationRound).values({ name: "R", supplierId: s!.id, policySnapshot: {}, status: "closed" }).returning();
    const res = await syncPaid(req("/x", {}), { params: { id: round!.id } });
    expect(res.status).toBe(400);
  });
});

describe("public health", () => {
  it("503 until the daily run reports in, then 200; body carries no details", async () => {
    const red = await publicHealthRoute();
    expect(red.status).toBe(503);
    expect(Object.keys(await red.json())).toEqual(["ok"]);
    const { setSetting } = await import("@/lib/settings");
    await setSetting("ops_sweep_last_run_at", new Date().toISOString(), "hb", db());
    expect((await publicHealthRoute()).status).toBe(200);
  });
});

describe("internal buyer provisioning (regression)", () => {
  it("creates the owner's buyer contact with an ordering role, not a browse-only one", async () => {
    const res = await provisionInternal(req("/api/admin/internal-buyer", {}));
    expect(res.status).toBeLessThan(300);
    const [contact] = await db().select().from(accountContact).where(eq(accountContact.email, "owner@example.com"));
    expect(contact!.roleOnAccount).toBe("primary");
    expect(canOrder(normalizeContactRole(contact!.roleOnAccount))).toBe(true);
  });
});
