import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createTestDb } from "./testDb";
import { account, application, applicationInvite, termsVersion, user as userTable } from "@/db/schema";
import type * as schema from "@/db/schema";

vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __inviteTestDb?: unknown }).__inviteTestDb;
    if (!t) throw new Error("invite test db not set");
    return t;
  },
}));
vi.mock("@/lib/rateLimit", () => ({
  clientIp: () => "test-ip",
  rateLimited: () => null,
  PUBLIC_WRITE_LIMITS: { applicationSubmit: { limit: 10, windowMs: 3600000 } },
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
  turnstileFailureBody: () => ({ error: "bot check failed" }),
}));
const deleteObjectMock = vi.fn(async (_key: string) => {});
vi.mock("@/lib/storage", () => ({
  putObject: async () => ({ key: `upload-${Math.random()}` }),
  deleteObject: (key: string) => deleteObjectMock(key),
}));
const sentEmails: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email/send", () => ({
  sendNotificationEmail: vi.fn(async (p: { to: string; subject: string; text: string }) => {
    sentEmails.push(p);
  }),
}));
vi.mock("@/lib/notifications", () => ({ notifyOwnersEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/actor", () => ({ requireActor: vi.fn() }));

import { POST as submitApplication } from "@/app/api/applications/route";
import { GET as listInvitesRoute, POST as createInviteRoute } from "@/app/api/admin/invites/route";
import { POST as revokeInviteRoute } from "@/app/api/admin/invites/[id]/revoke/route";
import { requireActor } from "@/lib/auth/actor";
import {
  consumeInvite,
  createInvite,
  findInvite,
  generateInviteCode,
  inviteProblem,
  inviteStatus,
  normalizeInviteCode,
} from "@/lib/applications/invites";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PDF_BYTES = Buffer.from("%PDF-1.4\n%fake resale certificate\n", "ascii");

function db(): PgliteDatabase<typeof schema> {
  return (globalThis as { __inviteTestDb?: PgliteDatabase<typeof schema> }).__inviteTestDb!;
}

function submitRequest(opts: { email: string; inviteCode?: string; business?: string }): NextRequest {
  const fields: Record<string, string> = {
    businessLegalName: opts.business ?? "Invited Cards LLC",
    entityType: "llc",
    formationState: "CA",
    channelType: "retail_store",
    addressLine1: "1 Main St",
    city: "Glendale",
    state: "CA",
    postalCode: "91201",
    contactName: "Ivy Invitee",
    contactEmail: opts.email,
    locationCount: "1",
    expectedMonthlyVolumeUsd: "3000",
    resaleCertNumber: "SR-999",
    resaleCertState: "CA",
    signatureName: "Ivy Invitee",
    termsAccepted: "true",
    aiDisclosureAccepted: "true",
  };
  if (opts.inviteCode) fields.inviteCode = opts.inviteCode;
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("productInterests", "pokemon");
  form.append("productInterests", "one-piece");
  form.append("resaleCertificate", new File([PDF_BYTES], "cert.pdf", { type: "application/pdf" }));
  return new NextRequest("http://localhost:3100/api/applications", { method: "POST", body: form });
}

function adminJson(path: string, body?: unknown) {
  return new NextRequest(`http://localhost:3100${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  const { db: fresh } = await createTestDb();
  (globalThis as { __inviteTestDb?: unknown }).__inviteTestDb = fresh;
  sentEmails.length = 0;
  deleteObjectMock.mockClear();
  vi.mocked(requireActor).mockReset();
  vi.mocked(requireActor).mockResolvedValue({ kind: "owner", user: { id: OWNER_ID, name: "Owner", email: "o@fanzia.io", role: "owner", mfaEnrolled: true } } as never);
  await fresh.insert(termsVersion).values({
    docType: "terms_of_sale",
    versionLabel: "v1",
    bodyMarkdown: "terms",
    isDraft: false,
    publishedAt: new Date(),
  });
  await fresh.insert(userTable).values({ id: OWNER_ID, email: "o@fanzia.io", name: "Owner", role: "owner" });
});

describe("invite codes: pure helpers", () => {
  it("generates 12-symbol codes from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("normalizes case, spaces and dashes", () => {
    expect(normalizeInviteCode(" abcd efgh-jkLM ")).toBe("ABCDEFGHJKLM");
  });

  it("status: used beats revoked beats expired", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const past = new Date("2026-09-01T00:00:00Z");
    const future = new Date("2026-11-01T00:00:00Z");
    expect(inviteStatus({ usedAt: null, revokedAt: null, expiresAt: future }, now)).toBe("active");
    expect(inviteStatus({ usedAt: null, revokedAt: null, expiresAt: past }, now)).toBe("expired");
    expect(inviteStatus({ usedAt: null, revokedAt: now, expiresAt: future }, now)).toBe("revoked");
    expect(inviteStatus({ usedAt: now, revokedAt: now, expiresAt: past }, now)).toBe("used");
  });
});

describe("invite codes: lifecycle", () => {
  it("stores only a hash of the code and finds it again case-insensitively", async () => {
    const { invite, code } = await createInvite(db(), { email: "Ivy@Example.com ", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    expect(invite.email).toBe("ivy@example.com");
    const [row] = await db().select().from(applicationInvite);
    expect(JSON.stringify(row)).not.toContain(normalizeInviteCode(code));
    const found = await findInvite(db(), code.toLowerCase());
    expect(found?.status).toBe("active");
    expect(inviteProblem(found, "IVY@example.com")).toBeNull();
    expect(inviteProblem(found, "someone@else.com")).toMatch(/different email/);
  });

  it("re-inviting the same email revokes the older active invite", async () => {
    const first = await createInvite(db(), { email: "ivy@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    const second = await createInvite(db(), { email: "IVY@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    expect(second.replacedInviteId).toBe(first.invite.id);
    expect((await findInvite(db(), first.code))?.status).toBe("revoked");
    expect((await findInvite(db(), second.code))?.status).toBe("active");
  });

  it("refuses to invite an email that already belongs to an approved account", async () => {
    await db().insert(account).values({
      legalName: "Existing LLC",
      channelType: "retail_store",
      addressLine1: "1",
      city: "Glendale",
      state: "CA",
      postalCode: "91201",
      primaryContactName: "E",
      primaryContactEmail: "Existing@Buyer.com",
    });
    await expect(
      createInvite(db(), { email: "existing@buyer.com", name: "E", createdBy: OWNER_ID, expiryDays: 14 }),
    ).rejects.toThrow(/already belongs/);
  });

  it("consume is single use: two concurrent consumes, one winner", async () => {
    const { code } = await createInvite(db(), { email: "ivy@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    // Two application rows to point the invite at.
    const results = await Promise.all(
      [1, 2].map(() =>
        db().transaction(async (tx) => consumeInvite(tx, { rawCode: code, email: "ivy@example.com", applicationId: null as unknown as string })),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("consume fails for the wrong email and for expired invites", async () => {
    const { code } = await createInvite(db(), { email: "ivy@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 1 });
    expect(await consumeInvite(db(), { rawCode: code, email: "other@example.com", applicationId: null as unknown as string })).toBeNull();
    const later = new Date(Date.now() + 2 * 24 * 3600_000);
    expect(await consumeInvite(db(), { rawCode: code, email: "ivy@example.com", applicationId: null as unknown as string, now: later })).toBeNull();
  });
});

describe("applying with an invite while applications are closed", () => {
  it("rejects a closed-portal submission without an invite", async () => {
    const res = await submitApplication(submitRequest({ email: "ivy@example.com" }));
    expect(res.status).toBe(403);
  });

  it("accepts a valid invite, links the application, and burns the code", async () => {
    const created = await createInviteRoute(adminJson("/api/admin/invites", { email: "ivy@example.com", name: "Ivy" }));
    expect(created.status).toBe(200);
    const { code, link } = await created.json();
    expect(link).toContain(`/apply?invite=${code}`);
    expect(sentEmails.some((e) => e.to === "ivy@example.com" && e.text.includes(code))).toBe(true);

    const res = await submitApplication(submitRequest({ email: "Ivy@Example.com", inviteCode: code }));
    expect(res.status).toBe(200);
    const [app] = await db().select().from(application);
    const [inv] = await db().select().from(applicationInvite);
    expect(app!.inviteId).toBe(inv!.id);
    expect(inv!.usedApplicationId).toBe(app!.id);
    expect(inv!.usedAt).not.toBeNull();

    // Second use of the same code: refused, and nothing new is created.
    const again = await submitApplication(submitRequest({ email: "ivy@example.com", inviteCode: code, business: "Other Biz LLC" }));
    expect(again.status).toBe(403);
    expect((await again.json()).error).toMatch(/already been used/);
    expect(await db().select().from(application)).toHaveLength(1);
  });

  it("refuses an invite used with a different email", async () => {
    const { code } = await createInvite(db(), { email: "ivy@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    const res = await submitApplication(submitRequest({ email: "mallory@example.com", inviteCode: code }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/different email/);
    expect(await db().select().from(application)).toHaveLength(0);
  });

  it("a revoked invite stops working", async () => {
    const { invite, code } = await createInvite(db(), { email: "ivy@example.com", name: "Ivy", createdBy: OWNER_ID, expiryDays: 14 });
    const revoked = await revokeInviteRoute(adminJson(`/api/admin/invites/${invite.id}/revoke`, {}), { params: { id: invite.id } });
    expect(revoked.status).toBe(200);
    const res = await submitApplication(submitRequest({ email: "ivy@example.com", inviteCode: code }));
    expect(res.status).toBe(403);
    const list = await (await listInvitesRoute(adminJson("/api/admin/invites"))).json();
    expect(list.invites[0].status).toBe("revoked");
  });

  it("invite routes are owner-only", async () => {
    vi.mocked(requireActor).mockResolvedValue({ kind: "ai_operator", agent: { id: "a" } } as never);
    const res = await createInviteRoute(adminJson("/api/admin/invites", { email: "x@example.com", name: "X" }));
    expect(res.status).toBe(403);
    expect(await db().select().from(applicationInvite).where(eq(applicationInvite.email, "x@example.com"))).toHaveLength(0);
  });
});
