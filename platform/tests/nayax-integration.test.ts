/**
 * Integration coverage for the Nayax connector: ingest idempotency and the
 * quarantine path, the weekly suggestion run against real seeded sales, the
 * per-week internal draft, and the engine-tagged sync into the open
 * allocation round. The seeded data mirrors design doc §3.4's worked example
 * (Machine A 84 packs/28d on-hand 10 → suggest 74; Machine B 56/28d
 * on-hand 20 → suggest 36; aggregate 110 → 4 boxes of 36).
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { makeAccount, makeProduct, makeSupplier } from "./catalogFixtures";
import { nayaxMachine, slotMap, nayaxSale, nayaxRestock, restockParams, internalRestockDraft } from "@/db/schema/nayax";
import { allocationLine, allocationRound } from "@/db/schema/allocation";
import { account } from "@/db/schema/account";
import { ingestSales } from "@/lib/nayax/ingest";
import { runWeeklySuggestion, weekKeyFor } from "@/lib/nayax/weekly";
import type { LynxLastSale } from "@/lib/nayax/client";

describe("nayax integration smoke (temp)", () => {
  it("ingest → weekly → draft → round sync mirrors the worked example", async () => {
    const { db } = await createTestDb();
    const now = new Date();

    const prod = await makeProduct(db, { sku: "KP-ABYSS-EYE-PACK", name: "Abyss Eye booster pack (JP)" });
    const [mA] = await db.insert(nayaxMachine).values({ nayaxMachineId: 111, name: "Glendale", location: "glendale" }).returning();
    const [mB] = await db.insert(nayaxMachine).values({ nayaxMachineId: 222, name: "Lakewood", location: "lakewood" }).returning();
    await db.insert(slotMap).values([
      { machineId: mA!.id, slotPosition: 1, productId: prod.id, capacityUnits: 40 },
      { machineId: mB!.id, slotPosition: 1, productId: prod.id, capacityUnits: 40 },
    ]);
    await db.insert(restockParams).values({
      productId: prod.id, leadTimeDays: 14, safetyStockDays: 7, reviewPeriodDays: 7,
      minOrderUnits: 1, preferredCaseSku: "booster box of 36", caseUnits: 36, trialQty: 36,
    });
    // Restocked 10 days ago: A sold 30 since (on-hand 10), B sold 20 since (on-hand 20).
    const restockAt = new Date(now.getTime() - 10 * 86400000);
    await db.insert(nayaxRestock).values([
      { machineId: mA!.id, slotPosition: 1, productId: prod.id, unitsRestored: 40, restockedAt: restockAt },
      { machineId: mB!.id, slotPosition: 1, productId: prod.id, unitsRestored: 40, restockedAt: restockAt },
    ]);

    // 84 units / 28d for A, 56 / 28d for B, spread over the trailing window.
    const sales = (units: number, machineId: string): LynxLastSale[] =>
      Array.from({ length: units }, (_, i) => ({
        TransactionID: `${machineId}-txn-${i}`,
        ProductName: "KP-ABYSS-EYE-PACK",
        Quantity: 1,
        AuthorizationValue: 500,
        AuthorizationDateTimeGMT: new Date(now.getTime() - ((i % 28) * 86400000 + 3600000)).toISOString(),
      }));
    const rA = await ingestSales(db, mA!.id, sales(84, "a"), "api");
    const rB = await ingestSales(db, mB!.id, sales(56, "b"), "api");
    expect(rA.inserted).toBe(84);
    expect(rB.inserted).toBe(56);
    expect(rA.quarantined).toHaveLength(0);

    // Idempotency: re-ingest the same batch.
    const rA2 = await ingestSales(db, mA!.id, sales(84, "a"), "api");
    expect(rA2.inserted).toBe(0);
    expect(rA2.skipped).toBe(84);

    // Quarantine: unknown product name.
    const rQ = await ingestSales(db, mA!.id, [{ TransactionID: "q-1", ProductName: "Mystery Pack XYZ", Quantity: 1, AuthorizationDateTimeGMT: now.toISOString() }], "api");
    expect(rQ.quarantined).toHaveLength(1);

    // Internal account + open round for the sync path.
    const internal = await makeAccount(db, { legalName: "Fanzia Vending — Internal", kind: "internal" });
    const supplier = await makeSupplier(db);
    const [round] = await db.insert(allocationRound).values({
      name: "Test round", supplierId: supplier.id, status: "collecting",
      policySnapshot: { mode: "fanzia_first" },
    }).returning();

    const weekly = await runWeeklySuggestion(db, { now });
    const [line] = weekly.lines;
    expect(line!.sku).toBe("KP-ABYSS-EYE-PACK");
    expect(line!.aggregateUnits).toBe(110);
    expect(line!.cases).toBe(4);
    const [a, b] = line!.machines;
    expect(a!.suggestedUnits).toBe(74);
    expect(b!.suggestedUnits).toBe(36);

    // Draft: idempotent per week, linked to internal account.
    const [draft] = await db.select().from(internalRestockDraft).where(eq(internalRestockDraft.weekKey, weekKeyFor(now)));
    expect(draft!.source).toBe("internal-suggestion");
    expect(draft!.buyerAccountId).toBe(internal.id);
    expect(draft!.lines).toHaveLength(1);

    // Round sync: engine-tagged line in the open round.
    expect(weekly.roundSync.synced).toBe(true);
    expect(weekly.roundSync.roundId).toBe(round!.id);
    const roundLines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round!.id));
    expect(roundLines).toHaveLength(1);
    expect(roundLines[0]!.accountId).toBe(internal.id);
    expect(roundLines[0]!.requestedQty).toBe(110);
    expect(roundLines[0]!.notes).toContain("source=internal-suggestion");

    // Second run same week: idempotent — no duplicate lines, draft updated not duplicated.
    const weekly2 = await runWeeklySuggestion(db, { now });
    const roundLines2 = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round!.id));
    expect(roundLines2).toHaveLength(1);
    expect(weekly2.roundSync.linesUpserted).toBe(1);

    // round table references the internal account now
    const [roundAfter] = await db.select().from(allocationRound).where(eq(allocationRound.id, round!.id));
    expect(roundAfter!.internalAccountId).toBe(internal.id);
    void account;
  });
});
