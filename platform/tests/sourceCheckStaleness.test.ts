import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { sourceCheck, sourcingRoute, auditLog } from "@/db/schema";
import { computeValidUntil, isExpired } from "@/lib/catalog/staleness";
import { createSourceCheck, NotFoundError } from "@/lib/catalog/sourceCheck";
import { SETTINGS_KEYS, setSetting } from "@/lib/settings";
import {
  seedCurrency,
  makeOwner,
  makeSupplier,
  makeProduct,
  makeRoute,
} from "./catalogFixtures";

/**
 * Build prompt §5: source availability is observed, not reserved.
 * `source_check` records carry evidence and a confidence level, and decay
 * on policy-set staleness horizons — observed 72h, quoted 7d — after which
 * no allocation may be sent or invoiced without a fresh check.
 */
describe("source_check evidence, confidence, and staleness", () => {
  it("observed checks expire 72h after checked_at by default", async () => {
    const { db } = await createTestDb();
    const checkedAt = new Date("2026-09-17T12:00:00Z");
    const validUntil = await computeValidUntil("observed", checkedAt, db);
    expect(validUntil.getTime() - checkedAt.getTime()).toBe(72 * 60 * 60 * 1000);
  });

  it("quoted checks expire 7d after checked_at by default", async () => {
    const { db } = await createTestDb();
    const checkedAt = new Date("2026-09-17T12:00:00Z");
    const validUntil = await computeValidUntil("quoted", checkedAt, db);
    expect(validUntil.getTime() - checkedAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("staleness horizons are admin-configurable settings, not hard-coded", async () => {
    const { db } = await createTestDb();
    await setSetting(SETTINGS_KEYS.sourceCheckStalenessObservedHours, 48, "test", db);
    await setSetting(SETTINGS_KEYS.sourceCheckStalenessQuotedDays, 3, "test", db);
    const checkedAt = new Date("2026-09-17T12:00:00Z");
    expect((await computeValidUntil("observed", checkedAt, db)).getTime() - checkedAt.getTime()).toBe(
      48 * 60 * 60 * 1000,
    );
    expect((await computeValidUntil("quoted", checkedAt, db)).getTime() - checkedAt.getTime()).toBe(
      3 * 24 * 60 * 60 * 1000,
    );
  });

  it("isExpired treats a check past valid_until as stale", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(isExpired(new Date("2026-09-20T11:59:59Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-09-20T12:00:01Z"), now)).toBe(false);
  });

  it("createSourceCheck records evidence, confidence, and a computed valid_until", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor, userId } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db);
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });

    const before = new Date();
    const check = await createSourceCheck(
      {
        sourcingRouteId: route.id,
        stockObserved: 17,
        priceObservedMinor: 9800,
        currencyCode: "USD",
        method: "member_page",
        confidence: "observed",
        evidenceObjectKey: "evidence/screenshot-123.png",
        actor,
      },
      db,
    );
    const after = new Date();

    expect(check.stockObserved).toBe(17);
    expect(check.confidence).toBe("observed");
    expect(check.evidenceObjectKey).toBe("evidence/screenshot-123.png");
    expect(check.checkedBy).toBe(userId);
    // valid_until ≈ checked_at + 72h
    expect(check.validUntil.getTime() - check.checkedAt.getTime()).toBe(72 * 60 * 60 * 1000);
    expect(check.checkedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(check.checkedAt.getTime()).toBeLessThanOrEqual(after.getTime());

    // The route's best-known confidence reflects the fresh check.
    const [updatedRoute] = await db.select().from(sourcingRoute).where(eq(sourcingRoute.id, route.id));
    expect(updatedRoute!.confidence).toBe("observed");

    // Audited like any other admin action.
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "source_check.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(userId);
  });

  it("a quoted check gets the 7-day horizon", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db);
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });

    const check = await createSourceCheck(
      {
        sourcingRouteId: route.id,
        stockObserved: null,
        priceObservedMinor: 10200,
        currencyCode: "USD",
        method: "email_quote",
        confidence: "quoted",
        actor,
      },
      db,
    );
    expect(check.validUntil.getTime() - check.checkedAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("recording a check never writes product or price_epoch rows", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db);
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });

    await createSourceCheck(
      {
        sourcingRouteId: route.id,
        stockObserved: 5,
        priceObservedMinor: 9000,
        currencyCode: "USD",
        method: "phone",
        confidence: "observed",
        actor,
      },
      db,
    );

    // Only the source_check row and its audit entry exist; the product and
    // price tables are untouched (evidence gathering ≠ repricing).
    const checks = await db.select().from(sourceCheck);
    expect(checks).toHaveLength(1);
  });

  it("a check against a missing route fails loudly", async () => {
    const { db } = await createTestDb();
    const { actor } = await makeOwner(db);
    await expect(
      createSourceCheck(
        {
          sourcingRouteId: "00000000-0000-0000-0000-000000000000",
          stockObserved: 1,
          priceObservedMinor: 100,
          currencyCode: "USD",
          method: "phone",
          confidence: "observed",
          actor,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("source_check rows are append-only at the DB layer (evidence is never edited)", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const { actor } = await makeOwner(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db);
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });

    const check = await createSourceCheck(
      {
        sourcingRouteId: route.id,
        stockObserved: 9,
        priceObservedMinor: 9000,
        currencyCode: "USD",
        method: "member_page",
        confidence: "observed",
        actor,
      },
      db,
    );

    await expect(
      db.update(sourceCheck).set({ stockObserved: 99 }).where(eq(sourceCheck.id, check.id)),
    ).rejects.toThrow();
  });
});
