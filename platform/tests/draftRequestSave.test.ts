import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { draftRequest, auditLog } from "@/db/schema";
import { saveDraftRequest, getDraftRequest } from "@/lib/catalog/draftRequest";
import { makeAccount } from "./catalogFixtures";

/**
 * Build prompt §1: "A request is not a sale." Phase 2 item 6: a buyer can
 * save a draft request with zero side effects — no order, no allocation,
 * no notification, no audit event. This test proves the save is a pure
 * upsert on the draft_request row.
 */
describe("draft-request save", () => {
  it("saves a draft with no submission side effects", async () => {
    const { db } = await createTestDb();
    const account = await makeAccount(db);

    const auditsBefore = await db.select().from(auditLog);

    const saved = await saveDraftRequest(
      account.id,
      {
        lines: [
          { productId: "11111111-1111-1111-1111-111111111111", qtyRequested: 3 },
          { productId: "22222222-2222-2222-2222-222222222222", qtyRequested: 10 },
        ],
        notes: "First pass — will confirm quantities tomorrow.",
      },
      db,
    );

    expect(saved.accountId).toBe(account.id);
    expect(saved.lines).toHaveLength(2);
    expect(saved.notes).toBe("First pass — will confirm quantities tomorrow.");

    // No audit event, no other rows: saving a draft is invisible to every
    // other subsystem.
    const auditsAfter = await db.select().from(auditLog);
    expect(auditsAfter.length).toBe(auditsBefore.length);
    expect(await db.select().from(draftRequest)).toHaveLength(1);
  });

  it("re-saving replaces the draft (one row per account)", async () => {
    const { db } = await createTestDb();
    const account = await makeAccount(db);

    await saveDraftRequest(
      account.id,
      { lines: [{ productId: "11111111-1111-1111-1111-111111111111", qtyRequested: 3 }], notes: "v1" },
      db,
    );
    const updated = await saveDraftRequest(
      account.id,
      { lines: [{ productId: "11111111-1111-1111-1111-111111111111", qtyRequested: 7 }], notes: "v2" },
      db,
    );

    const rows = await db.select().from(draftRequest).where(eq(draftRequest.accountId, account.id));
    expect(rows).toHaveLength(1);
    expect(updated.lines).toEqual([{ productId: "11111111-1111-1111-1111-111111111111", qtyRequested: 7 }]);
    expect(updated.notes).toBe("v2");
  });

  it("getDraftRequest returns the saved draft, or null when none exists", async () => {
    const { db } = await createTestDb();
    const account = await makeAccount(db);

    expect(await getDraftRequest(account.id, db)).toBeNull();

    await saveDraftRequest(
      account.id,
      { lines: [{ productId: "33333333-3333-3333-3333-333333333333", qtyRequested: 1 }], notes: "" },
      db,
    );
    const fetched = await getDraftRequest(account.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched!.lines).toHaveLength(1);
  });

  it("drafts are scoped per account (one buyer cannot see another's)", async () => {
    const { db } = await createTestDb();
    const a = await makeAccount(db);
    const b = await makeAccount(db);

    await saveDraftRequest(
      a.id,
      { lines: [{ productId: "44444444-4444-4444-4444-444444444444", qtyRequested: 2 }], notes: "a's draft" },
      db,
    );
    expect(await getDraftRequest(b.id, db)).toBeNull();
  });

  it("invalid input is rejected by the schema (no partial write)", async () => {
    const { db } = await createTestDb();
    const account = await makeAccount(db);
    const { draftRequestInputSchema } = await import("@/lib/catalog/draftRequest");

    const bad = draftRequestInputSchema.safeParse({
      lines: [{ productId: "not-a-uuid", qtyRequested: -5 }],
      notes: "x".repeat(5000),
    });
    expect(bad.success).toBe(false);
    expect(await db.select().from(draftRequest)).toHaveLength(0);
  });
});
