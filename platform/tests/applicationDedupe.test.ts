import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { application as applicationTable } from "@/db/schema";
import { findDuplicateApplication, normalizeIdentity } from "@/lib/applications/dedupe";
import { hashToken } from "@/lib/crypto";

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    businessLegalName: "Acme TCG LLC",
    channelType: "live_seller" as const,
    addressLine1: "1 Main St",
    city: "Glendale",
    state: "CA",
    postalCode: "91206",
    country: "US",
    contactName: "Jane Doe",
    contactEmail: "jane@acmetcg.example",
    status: "submitted" as const,
    resumeTokenHash: hashToken(`token-${Math.random().toString(36).slice(2)}`),
    resumeTokenExpiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

describe("application dedupe", () => {
  it("normalizes names for comparison", () => {
    expect(normalizeIdentity("  Acme   TCG  LLC ")).toBe("acme tcg llc");
  });

  it("flags the same email on a live application", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow());
    const dup = await findDuplicateApplication("Totally Different Inc", "jane@acmetcg.example", db);
    expect(dup).not.toBeNull();
    expect(dup!.businessLegalName).toBe("Acme TCG LLC");
  });

  it("flags the same business name, case-insensitively", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow());
    const dup = await findDuplicateApplication("  ACME  tcg LLC ", "other@example.com", db);
    expect(dup).not.toBeNull();
  });

  it("matches needs_review applications too", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow({ status: "needs_review" }));
    const dup = await findDuplicateApplication("Acme TCG LLC", "someone-else@example.com", db);
    expect(dup).not.toBeNull();
  });

  it("ignores declined applications (re-applying is allowed)", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow({ status: "declined" }));
    const dup = await findDuplicateApplication("Acme TCG LLC", "jane@acmetcg.example", db);
    expect(dup).toBeNull();
  });

  it("ignores approved applications", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow({ status: "approved" }));
    const dup = await findDuplicateApplication("Acme TCG LLC", "jane@acmetcg.example", db);
    expect(dup).toBeNull();
  });

  it("returns null when there is no overlap", async () => {
    const { db } = await createTestDb();
    await db.insert(applicationTable).values(appRow());
    const dup = await findDuplicateApplication("Different Business", "new@example.com", db);
    expect(dup).toBeNull();
  });
});
