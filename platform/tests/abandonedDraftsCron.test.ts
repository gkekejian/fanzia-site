import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "./testDb";
import { draftRequest, draftReminderLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/cron/abandoned-drafts/route";
import { runAbandonedDraftSweep, ABANDONED_DRAFT_AFTER_MS } from "@/lib/catalog/draftReminders";
import { draftReminderBody } from "@/lib/email/relationship";
import {
  seedCurrency,
  makeSupplier,
  makeProduct,
  makeRoute,
  makePriceEpoch,
  makeAccount,
} from "./catalogFixtures";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function authed(secret: string | null) {
  const req = new NextRequest("http://localhost/api/cron/abandoned-drafts");
  if (secret !== null) req.headers.set("authorization", `Bearer ${secret}`);
  return req;
}

describe("abandoned-drafts cron auth", () => {
  it("401 without any Authorization header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await GET(authed(null));
    expect(res.status).toBe(401);
  });

  it("401 with the wrong secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await GET(authed("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("401 when no secret is configured at all", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(authed("anything"));
    expect(res.status).toBe(401);
  });
});

describe("abandoned-draft sweep", () => {
  it("reminds once per draft version, then never again for the same version", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db, { sku: "SWEEP-1", status: "active", publiclyVisible: true });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id, priceMinor: 10000 });

    const account = await makeAccount(db);
    const oldDate = new Date(Date.now() - ABANDONED_DRAFT_AFTER_MS - 60_000);
    await db.insert(draftRequest).values({
      accountId: account.id,
      lines: [{ productId: product.id, qtyRequested: 2 }],
      updatedAt: oldDate,
    });

    const sent: { to: string; subject: string }[] = [];
    const input = {
      sendEmail: async (params: { to: string; subject: string; text: string; listName: string }) => {
        sent.push({ to: params.to, subject: params.subject });
        // Body must be honest: no fake scarcity, includes resume path.
        expect(params.text).toContain("Nothing is reserved");
        expect(params.listName).toBe("abandoned-draft-reminders");
      },
      resumeUrl: "https://app.fanzia.io/member/draft-request",
      formatMoney: (minor: number) => `$${(minor / 100).toFixed(2)}`,
      draftReminderBody,
    };

    const first = await runAbandonedDraftSweep(input, db, new Date());
    expect(first.checked).toBe(1);
    expect(first.reminded).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(account.primaryContactEmail);

    const logs = await db.select().from(draftReminderLog).where(eq(draftReminderLog.accountId, account.id));
    expect(logs).toHaveLength(1);

    // Second run: same draft version → reminded again would be a bug.
    const second = await runAbandonedDraftSweep(input, db, new Date());
    expect(second.reminded).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("a failed send is not logged, so the next run retries", async () => {
    const { db } = await createTestDb();
    await seedCurrency(db);
    const supplier = await makeSupplier(db);
    const product = await makeProduct(db, { sku: "SWEEP-2", status: "active", publiclyVisible: true });
    const route = await makeRoute(db, { productId: product.id, supplierId: supplier.id });
    await makePriceEpoch(db, { productId: product.id, sourcingRouteId: route.id, priceMinor: 10000 });

    const account = await makeAccount(db);
    await db.insert(draftRequest).values({
      accountId: account.id,
      lines: [{ productId: product.id, qtyRequested: 1 }],
      updatedAt: new Date(Date.now() - ABANDONED_DRAFT_AFTER_MS - 60_000),
    });

    let attempts = 0;
    const input = {
      sendEmail: async () => {
        attempts++;
        throw new Error("SMTP down");
      },
      resumeUrl: "https://x/member/draft-request",
      formatMoney: (minor: number) => String(minor),
      draftReminderBody: () => "body",
    };

    const result = await runAbandonedDraftSweep(input, db, new Date());
    expect(result.reminded).toBe(0);
    expect(result.failed).toBe(1);
    expect(attempts).toBe(1);
    // Not logged → still eligible next run.
    expect(await db.select().from(draftReminderLog)).toHaveLength(0);
  });
});
