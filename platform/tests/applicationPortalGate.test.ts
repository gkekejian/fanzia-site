import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createTestDb } from "./testDb";
import { application, termsVersion, settings as settingsTable, auditLog, user as userTable } from "@/db/schema";
import type * as schema from "@/db/schema";
import { SETTINGS_KEYS } from "@/lib/settings";

// The routes bind the real db client at module scope; point them at the
// per-test PGlite instance through a lazily-resolved mock (same pattern as
// tests/applicationSubmitMultipart.test.ts).
vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __portalGateTestDb?: unknown }).__portalGateTestDb;
    if (!t) throw new Error("portal-gate test db not set");
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

const putObjectMock = vi.fn(async (_buffer: Buffer) => ({ key: "test-upload-key" }));
const deleteObjectMock = vi.fn(async (_key: string) => {});
vi.mock("@/lib/storage", () => ({
  putObject: (buffer: Buffer) => putObjectMock(buffer),
  deleteObject: (key: string) => deleteObjectMock(key),
}));
vi.mock("@/lib/email/send", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/notifications", () => ({
  notifyOwnersEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/actor", () => ({
  requireActor: vi.fn(),
}));

import { POST as submitApplication } from "@/app/api/applications/route";
import {
  GET as getPortalSetting,
  POST as setPortalSetting,
} from "@/app/api/admin/settings/applications/route";
import { requireActor } from "@/lib/auth/actor";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%fake resale certificate\n", "ascii");

function testDb(): PgliteDatabase<typeof schema> {
  const db = (globalThis as { __portalGateTestDb?: PgliteDatabase<typeof schema> }).__portalGateTestDb;
  if (!db) throw new Error("test db not initialized");
  return db;
}

function validFields(): Record<string, string> {
  return {
    businessLegalName: "Acme Comics LLC",
    entityType: "llc",
    formationState: "CA",
    channelType: "retail_store",
    addressLine1: "123 Main St",
    city: "Glendale",
    state: "CA",
    postalCode: "91201",
    contactName: "Jane Doe",
    contactEmail: "jane@acme.example",
    locationCount: "2",
    expectedMonthlyVolumeUsd: "5000",
    resaleCertNumber: "SR-123456",
    resaleCertState: "CA",
    signatureName: "Jane Doe",
    termsAccepted: "true",
    aiDisclosureAccepted: "true",
  };
}

function buildSubmitRequest(): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(validFields())) form.append(k, v);
  form.append("productInterests", "pokemon");
  form.append("productInterests", "one-piece");
  form.append("resaleCertificate", new File([PDF_BYTES], "cert.pdf", { type: "application/pdf" }));
  return new NextRequest("http://localhost:3100/api/applications", { method: "POST", body: form });
}

function adminRequest(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ownerActor = {
  kind: "owner",
  user: { id: OWNER_ID, name: "Owner", email: "owner@example.com" },
};

describe("application portal kill switch", () => {
  beforeEach(async () => {
    const { db } = await createTestDb();
    (globalThis as { __portalGateTestDb?: unknown }).__portalGateTestDb = db;
    putObjectMock.mockClear().mockResolvedValue({ key: "test-upload-key" });
    deleteObjectMock.mockClear();
    vi.mocked(requireActor).mockReset();
    await db.insert(termsVersion).values({
      docType: "terms_of_sale",
      versionLabel: "draft-v2",
      bodyMarkdown: "terms text",
      isDraft: false,
      publishedAt: new Date(),
    });
    // The toggle route audits with the actor's user id (FK to "user").
    await db.insert(userTable).values({
      id: OWNER_ID,
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
    });
  });

  it("refuses new submissions with 403 while the portal is closed (default: unset)", async () => {
    const res = await submitApplication(buildSubmitRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not accepting new wholesale applications/i);
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(await testDb().select().from(application)).toHaveLength(0);
  });

  it("accepts submissions once the portal is opened", async () => {
    await testDb().insert(settingsTable).values({
      key: SETTINGS_KEYS.applicationsOpen,
      value: true,
      description: "test",
    });
    const res = await submitApplication(buildSubmitRequest());
    expect(res.status).toBe(200);
    expect(await testDb().select().from(application)).toHaveLength(1);
  });

  it("owner toggle flips the portal and writes an audit entry", async () => {
    vi.mocked(requireActor).mockResolvedValue(ownerActor as never);

    // Starts closed by default.
    const initial = await getPortalSetting(adminRequest("/api/admin/settings/applications", "GET"));
    expect(initial.status).toBe(200);
    expect((await initial.json()).open).toBe(false);

    const opened = await setPortalSetting(
      adminRequest("/api/admin/settings/applications", "POST", { open: true }),
    );
    expect(opened.status).toBe(200);
    expect((await opened.json()).open).toBe(true);

    const afterOpen = await getPortalSetting(adminRequest("/api/admin/settings/applications", "GET"));
    expect((await afterOpen.json()).open).toBe(true);

    const closed = await setPortalSetting(
      adminRequest("/api/admin/settings/applications", "POST", { open: false }),
    );
    expect((await closed.json()).open).toBe(false);

    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "portal.applications_opened"));
    expect(audits.length).toBe(1);
    expect(audits[0]!.entityType).toBe("setting");
    expect(audits[0]!.entityId).toBe("applications_open");
  });

  it("rejects a non-boolean toggle body", async () => {
    vi.mocked(requireActor).mockResolvedValue(ownerActor as never);
    const res = await setPortalSetting(
      adminRequest("/api/admin/settings/applications", "POST", { open: "yes" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated toggle access", async () => {
    vi.mocked(requireActor).mockResolvedValue(new NextResponse("unauthorized", { status: 401 }) as never);
    const res = await getPortalSetting(adminRequest("/api/admin/settings/applications", "GET"));
    expect(res.status).toBe(401);
  });
});
