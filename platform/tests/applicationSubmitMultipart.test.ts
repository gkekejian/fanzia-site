import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createTestDb } from "./testDb";
import { application, applicationDocument, termsAcceptance, termsVersion } from "@/db/schema";
import type * as schema from "@/db/schema";

// The route binds the real db client at module scope; point it at the
// per-test PGlite instance through a lazily-resolved mock (same pattern as
// tests/ops-sweep.test.ts).
vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __appSubmitTestDb?: unknown }).__appSubmitTestDb;
    if (!t) throw new Error("app-submit test db not set");
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

import { POST } from "@/app/api/applications/route";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%fake resale certificate\n", "ascii");
const TEXT_BYTES = Buffer.from("this is plain text, not a certificate", "ascii");

function testDb(): PgliteDatabase<typeof schema> {
  const db = (globalThis as { __appSubmitTestDb?: PgliteDatabase<typeof schema> }).__appSubmitTestDb;
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

function buildRequest(opts: {
  fields?: Record<string, string>;
  file?: { bytes: Buffer; filename: string; type?: string } | null;
}): NextRequest {
  const form = new FormData();
  const fields = opts.fields ?? validFields();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("productInterests", "pokemon");
  form.append("productInterests", "one-piece");
  if (opts.file !== null) {
    const { bytes, filename, type } = opts.file ?? {
      bytes: PDF_BYTES,
      filename: "cert.pdf",
      type: "application/pdf",
    };
    form.append("resaleCertificate", new File([bytes], filename, { type }));
  }
  return new NextRequest("http://localhost:3100/api/applications", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/applications multipart intake", () => {
  beforeEach(async () => {
    const { db } = await createTestDb();
    (globalThis as { __appSubmitTestDb?: unknown }).__appSubmitTestDb = db;
    putObjectMock.mockClear().mockResolvedValue({ key: "test-upload-key" });
    deleteObjectMock.mockClear();
    await db.insert(termsVersion).values({
      docType: "terms_of_sale",
      versionLabel: "draft-v2",
      bodyMarkdown: "terms text",
      isDraft: false,
      publishedAt: new Date(),
    });
  });

  it("rejects a submission with no certificate file", async () => {
    const res = await POST(buildRequest({ file: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/resale certificate is required/i);
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(await testDb().select().from(application)).toHaveLength(0);
  });

  it("rejects an empty certificate file", async () => {
    const res = await POST(
      buildRequest({ file: { bytes: Buffer.alloc(0), filename: "cert.pdf", type: "application/pdf" } }),
    );
    expect(res.status).toBe(400);
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(await testDb().select().from(application)).toHaveLength(0);
  });

  it("rejects a certificate with an invalid MIME (content-sniffed, not extension)", async () => {
    const res = await POST(
      buildRequest({ file: { bytes: TEXT_BYTES, filename: "cert.pdf", type: "application/pdf" } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported file type/i);
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized certificate", async () => {
    const big = Buffer.alloc(15 * 1024 * 1024 + 1);
    big.write("%PDF");
    const res = await POST(buildRequest({ file: { bytes: big, filename: "cert.pdf", type: "application/pdf" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("accepts a valid submission and stores cert + clickwrap atomically", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(putObjectMock).toHaveBeenCalledTimes(1);

    const db = testDb();
    const apps = await db.select().from(application);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.businessLegalName).toBe("Acme Comics LLC");
    expect(apps[0]!.resaleCertNumber).toBe("SR-123456");

    const docs = await db.select().from(applicationDocument);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.applicationId).toBe(apps[0]!.id);
    expect(docs[0]!.storageKey).toBe("test-upload-key");
    expect(docs[0]!.mimeVerified).toBe("application/pdf");

    const acceptances = await db.select().from(termsAcceptance);
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]!.applicationId).toBe(apps[0]!.id);
    expect(acceptances[0]!.visibleLanguageSnapshot).toContain("draft-v2");

    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("leaves no half-application when storage fails", async () => {
    putObjectMock.mockRejectedValueOnce(new Error("R2 down"));
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(500);

    const db = testDb();
    expect(await db.select().from(application)).toHaveLength(0);
    expect(await db.select().from(applicationDocument)).toHaveLength(0);
    // Nothing was stored, so there is no orphan to clean up.
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});
