import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { auditLog } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

// Build prompt §14.1: "Owners still cannot delete or alter the audit log —
// nobody can." Enforced at the DB layer for every role, not just omitted
// from the application's own code paths.
describe("audit_log append-only", () => {
  it("recordAudit() writes a row", async () => {
    const { db } = await createTestDb();
    await recordAudit(
      { actorType: "system", action: "test.action", entityType: "test", entityId: "1" },
      db,
    );
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
  });

  it("rejects UPDATE even from a query with no application-level guard", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(auditLog)
      .values({ actorType: "owner", action: "x", entityType: "y" })
      .returning();

    await expect(
      db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, row!.id)),
    ).rejects.toThrow();
  });

  it("rejects DELETE even from a query with no application-level guard", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(auditLog)
      .values({ actorType: "owner", action: "x", entityType: "y" })
      .returning();

    await expect(db.delete(auditLog).where(eq(auditLog.id, row!.id))).rejects.toThrow();
  });
});
