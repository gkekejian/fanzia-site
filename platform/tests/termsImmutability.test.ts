import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { termsVersion } from "@/db/schema";

// Build prompt §12 / test gate #20: "published terms remain immutable" —
// enforced at the DB layer (db/migrations/0003_immutability_triggers.sql),
// not by application convention.
describe("terms_version immutability", () => {
  it("allows editing a draft before it is published", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(termsVersion)
      .values({ docType: "terms_of_sale", versionLabel: "draft-v1", bodyMarkdown: "draft text" })
      .returning();

    await expect(
      db.update(termsVersion).set({ bodyMarkdown: "edited draft" }).where(eq(termsVersion.id, row!.id)),
    ).resolves.toBeDefined();
  });

  it("allows the publish transition itself (draft -> published)", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(termsVersion)
      .values({ docType: "privacy_policy", versionLabel: "draft-v1", bodyMarkdown: "draft text" })
      .returning();

    await expect(
      db
        .update(termsVersion)
        .set({ publishedAt: new Date(), isDraft: false })
        .where(eq(termsVersion.id, row!.id)),
    ).resolves.toBeDefined();
  });

  it("blocks any update to an already-published row", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(termsVersion)
      .values({
        docType: "shipping_policy",
        versionLabel: "v1",
        bodyMarkdown: "final text",
        publishedAt: new Date(),
        isDraft: false,
      })
      .returning();

    await expect(
      db.update(termsVersion).set({ bodyMarkdown: "tampered" }).where(eq(termsVersion.id, row!.id)),
    ).rejects.toThrow();
  });

  it("blocks deleting an already-published row", async () => {
    const { db } = await createTestDb();
    const [row] = await db
      .insert(termsVersion)
      .values({
        docType: "returns_policy",
        versionLabel: "v1",
        bodyMarkdown: "final text",
        publishedAt: new Date(),
        isDraft: false,
      })
      .returning();

    await expect(db.delete(termsVersion).where(eq(termsVersion.id, row!.id))).rejects.toThrow();
  });
});
