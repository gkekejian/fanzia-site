/**
 * Second review pass (2026-09-23): settings center, order rules, module
 * flags, email routing + outbox, health checks, drop-cycle automation
 * (paid-invoice sync + shortfall refunds), disputes, KPIs, digest,
 * reminders, and the Today queue.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  account,
  accountContact,
  allocationLine,
  allocationRound,
  application,
  auditLog,
  contactMessage,
  currency,
  emailOutbox,
  invoice,
  notification,
  orderRequest,
  payment,
  priceEpoch,
  product,
  refundDue,
  settings,
  sourcingRoute,
  supplier,
  user,
  type OrderRequestLine,
} from "@/db/schema";
import { defaultConfig, loadConfig, saveSettings, validateSetting, SETTING_DEFS } from "@/lib/config";
import { getOrderRules } from "@/lib/invoicing/orderRules";
import { isWholeCases, DEFAULT_ORDER_RULES } from "@/lib/invoicing/rules";
import { milestoneProgress } from "@/lib/member/shopping";
import { saveDraftRequest } from "@/lib/catalog/draftRequest";
import {
  submitDraftRequest,
  approveOrderRequest,
  OrderingPausedError,
  AccountOnHoldError,
  NotWholeCasesError,
  BelowMinimumError,
  FirstOrderCapError,
  type BuyerIdentity,
} from "@/lib/invoicing/service";
import { shouldEmailOwners, notifyOwnersEvent } from "@/lib/notifications";
import { enqueueFailedEmail, retryEmailOutbox, OUTBOX_MAX_ATTEMPTS } from "@/lib/email/outbox";
import { configChecks, heartbeatCheck, runHealthChecks, publicHealth, OPS_SWEEP_HEARTBEAT_KEY } from "@/lib/ops/health";
import { computeShortfalls, syncPaidInvoicesIntoRound, settleRoundShortfalls, markRefundResolved } from "@/lib/allocation/fromInvoices";
import { processStripeWebhook } from "@/lib/invoicing/stripe";
import { autoApproveIfEligible } from "@/lib/invoicing/autoApprove";
import { ageReceivables, costAt, grossProfit, isWorkflowStep, weekStartUtc, computeKpis, bps } from "@/lib/analytics/kpis";
import { buildDigest, maybeSendWeeklyDigest } from "@/lib/analytics/digest";
import { maybeSendDecisionReminder } from "@/lib/ops/reminders";
import { getActionQueue } from "@/lib/ops/today";
import { setSetting } from "@/lib/settings";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
let db: TestDb;
const uid = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  ({ db } = await createTestDb());
  delete process.env.RESEND_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// ── fixtures ────────────────────────────────────────────────────────────
async function seedOwner(email = `owner-${uid()}@fanzia.io`) {
  const [u] = await db.insert(user).values({ email, name: "Owner", role: "owner" }).returning();
  return u!;
}
async function seedAccount(overrides: Partial<typeof account.$inferInsert> = {}) {
  const [a] = await db
    .insert(account)
    .values({
      legalName: `Buyer ${uid()} LLC`,
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Pat",
      primaryContactEmail: `pat-${uid()}@buyer.example`,
      ...overrides,
    })
    .returning();
  return a!;
}
async function seedBuyer(accountId: string): Promise<BuyerIdentity> {
  const [c] = await db
    .insert(accountContact)
    .values({ accountId, name: "Pat", email: `pat-${uid()}@buyer.example`, roleOnAccount: "purchaser" })
    .returning();
  return { accountContactId: c!.id, accountId, contactName: c!.name, contactEmail: c!.email, contactRole: "purchaser" };
}
async function seedProduct(priceMinor: number, opts: { unitsPerCase?: number | null; costMinor?: number; effectiveAt?: Date } = {}) {
  await db.insert(currency).values({ code: "USD", exponent: 2, name: "US Dollar" }).onConflictDoNothing();
  const [p] = await db
    .insert(product)
    .values({
      sku: `SKU-${uid()}`,
      name: `Booster ${uid()}`,
      editionLanguage: "Japanese",
      origin: "Japan",
      condition: "sealed",
      packsPerUnit: 30,
      releaseStatus: "released",
      descriptionOriginal: "fixture",
      status: "active",
      publiclyVisible: true,
      unitsPerCase: opts.unitsPerCase ?? null,
    })
    .returning();
  await db.insert(priceEpoch).values({
    productId: p!.id,
    currencyCode: "USD",
    costMinor: opts.costMinor ?? Math.round(priceMinor / 1.28),
    markupBps: 2800,
    priceMinor,
    realizedGrossMarginBps: 2188,
    ...(opts.effectiveAt ? { effectiveAt: opts.effectiveAt } : {}),
  });
  return p!;
}
async function seedInvoice(accountId: string, lines: OrderRequestLine[], status = "paid", extra: Partial<typeof invoice.$inferInsert> = {}) {
  const subtotal = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
  const [i] = await db
    .insert(invoice)
    .values({
      invoiceNumber: `FZ-T-${uid().toUpperCase()}`,
      accountId,
      lines,
      subtotalMinor: subtotal,
      smallOrderFeeMinor: 0,
      taxMinor: 0,
      totalMinor: subtotal,
      status,
      ...extra,
    })
    .returning();
  return i!;
}
const line = (p: { id: string; sku: string; name: string }, qty: number, unit: number): OrderRequestLine => ({
  productId: p.id,
  sku: p.sku,
  name: p.name,
  qtyRequested: qty,
  unitPriceMinor: unit,
  lineTotalMinor: qty * unit,
  currencyCode: "USD",
});

// ── settings center ─────────────────────────────────────────────────────
describe("settings registry", () => {
  it("every def has a default that passes its own validation", () => {
    for (const def of SETTING_DEFS) {
      expect(validateSetting(def.key, def.default).ok, def.key).toBe(true);
    }
  });

  it("rejects out-of-range, wrong-type, and unknown keys with owner-readable errors", () => {
    expect(validateSetting("order_minimum_minor", -1)).toMatchObject({ ok: false });
    expect(validateSetting("offer_expiry_hours", 5)).toMatchObject({ ok: false });
    expect(validateSetting("ordering_paused", "yes")).toMatchObject({ ok: false });
    expect(validateSetting("owner_email_mode", "sometimes")).toMatchObject({ ok: false });
    expect(validateSetting("nope", 1)).toMatchObject({ ok: false });
    expect(validateSetting("order_minimum_minor", "60000")).toEqual({ ok: true, value: 60000 });
  });

  it("saveSettings is all-or-nothing and loadConfig reads it back", async () => {
    const bad = await saveSettings({ order_minimum_minor: 30000, offer_expiry_hours: 1 }, db);
    expect(bad.ok).toBe(false);
    expect((await loadConfig(db)).order_minimum_minor).toBe(50000); // nothing saved

    const good = await saveSettings({ order_minimum_minor: 30000, ordering_paused: true }, db);
    expect(good.ok).toBe(true);
    const cfg = await loadConfig(db);
    expect(cfg.order_minimum_minor).toBe(30000);
    expect(cfg.ordering_paused).toBe(true);
  });

  it("a garbled stored value falls back to the default instead of breaking", async () => {
    await db.insert(settings).values({ key: "order_minimum_minor", value: "lots", description: "x" });
    expect((await loadConfig(db)).order_minimum_minor).toBe(50000);
  });

  it("an unreachable database yields defaults, never a thrown error", async () => {
    const broken = { select: () => { throw new Error("db down"); } } as unknown as TestDb;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadConfig(broken)).toEqual(defaultConfig());
    spy.mockRestore();
  });

  it("modules default to the pivot: vending on; price intel, AI operator, cashbook off", () => {
    const d = defaultConfig();
    expect(d.module_vending).toBe(true);
    expect(d.module_price_intel).toBe(false);
    expect(d.module_ai_operator).toBe(false);
    expect(d.module_accounting).toBe(false);
  });
});

// ── order rules enforced from settings ──────────────────────────────────
describe("order rules come from Settings", () => {
  it("case-only math", () => {
    expect(isWholeCases(12, 6, true)).toBe(true);
    expect(isWholeCases(7, 6, true)).toBe(false);
    expect(isWholeCases(7, 6, false)).toBe(true);
    expect(isWholeCases(7, null, true)).toBe(true);
  });

  it("milestone progress uses the live minimum and fee, and drops the fee label at $0", () => {
    const rules = { minimumMinor: 30000, smallOrderThresholdMinor: 40000, smallOrderFeeMinor: 0 };
    const p = milestoneProgress(20000, rules);
    expect(p.minMet).toBe(false);
    expect(p.feeApplies).toBe(false);
    expect(p.message).toContain("$300");
    expect(p.message).not.toContain("fee");
    expect(milestoneProgress(20000).message).toContain("$500"); // defaults unchanged
  });

  async function draftFor(qty: number, opts: { unitsPerCase?: number | null; price?: number } = {}) {
    const acct = await seedAccount();
    const buyer = await seedBuyer(acct.id);
    const p = await seedProduct(opts.price ?? 10000, { unitsPerCase: opts.unitsPerCase ?? null });
    await saveDraftRequest(acct.id, { lines: [{ productId: p.id, qtyRequested: qty }], notes: "" }, db);
    return { acct, buyer, p };
  }

  it("pause blocks submission with the owner's message", async () => {
    const { buyer } = await draftFor(10);
    await saveSettings({ ordering_paused: true, ordering_paused_message: "Back Monday." }, db);
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(OrderingPausedError);
    await expect(submitDraftRequest(db, buyer)).rejects.toThrow("Back Monday.");
  });

  it("an account on hold cannot submit", async () => {
    const { acct, buyer } = await draftFor(10);
    await db.update(account).set({ orderingHoldReason: "dispute" }).where(eq(account.id, acct.id));
    await expect(submitDraftRequest(db, buyer)).rejects.toBeInstanceOf(AccountOnHoldError);
  });

  it("case-only mode rejects partial cases and accepts whole ones", async () => {
    const partial = await draftFor(7, { unitsPerCase: 6 });
    await expect(submitDraftRequest(db, partial.buyer)).rejects.toBeInstanceOf(NotWholeCasesError);
    const whole = await draftFor(12, { unitsPerCase: 6 });
    await expect(submitDraftRequest(db, whole.buyer)).resolves.toBeTruthy();
  });

  it("minimum, fee, and expiry follow Settings", async () => {
    await saveSettings({ order_minimum_minor: 20000, small_order_fee_minor: 0, offer_expiry_hours: 72 }, db);
    const { buyer } = await draftFor(3); // $300, under the old $500 minimum
    const before = Date.now();
    const req = await submitDraftRequest(db, buyer);
    expect(req.subtotalMinor).toBe(30000);
    expect(req.smallOrderFeeMinor).toBe(0);
    const hours = (req.expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);

    await saveSettings({ order_minimum_minor: 100000 }, db);
    const second = await draftFor(3);
    await expect(submitDraftRequest(db, second.buyer)).rejects.toBeInstanceOf(BelowMinimumError);
  });

  it("first-order cap follows Settings at approval", async () => {
    await saveSettings({ first_order_cap_minor: 50000 }, db);
    const { buyer } = await draftFor(6); // $600
    const req = await submitDraftRequest(db, buyer);
    const owner = await seedOwner();
    await expect(approveOrderRequest(db, req.id, owner.id)).rejects.toBeInstanceOf(FirstOrderCapError);
  });

  it("getOrderRules defaults match the historical constants", async () => {
    const r = await getOrderRules(db);
    expect(r.minimumMinor).toBe(DEFAULT_ORDER_RULES.minimumMinor);
    expect(r.smallOrderFeeMinor).toBe(DEFAULT_ORDER_RULES.smallOrderFeeMinor);
    expect(r.offerExpiryHours).toBe(48);
  });
});

// ── notifications & outbox ──────────────────────────────────────────────
describe("owner email routing", () => {
  it("routes by mode; urgent always emails", () => {
    const info = { severity: "info" as const };
    expect(shouldEmailOwners(info, "all")).toBe(true);
    expect(shouldEmailOwners(info, "action_needed")).toBe(false);
    expect(shouldEmailOwners({ actionNeeded: true }, "action_needed")).toBe(true);
    expect(shouldEmailOwners({ severity: "warning" }, "action_needed")).toBe(true);
    expect(shouldEmailOwners({ actionNeeded: true }, "digest_only")).toBe(false);
    expect(shouldEmailOwners({ urgent: true }, "digest_only")).toBe(true);
  });

  it("an FYI event is stored in-app but not emailed under the default mode", async () => {
    await seedOwner();
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
    await notifyOwnersEvent({ type: "invoice_paid", title: "Paid", body: "x" }, db);
    spy.mockRestore();
    expect(logged.filter((l) => l.includes("[email:dev-fallback]"))).toHaveLength(0);
    expect(await db.select().from(notification)).toHaveLength(1);
  });
});

describe("email outbox", () => {
  it("queues a failed email, retries it, and marks it sent", async () => {
    await enqueueFailedEmail({ to: "a@b.co", subject: "Hi", text: "Body" }, "test", "boom", db);
    const later = new Date(Date.now() + 2 * 3_600_000);
    const send = vi.fn(async () => ({}));
    const r = await retryEmailOutbox(db, send, later);
    expect(r).toEqual({ sent: 1, retried: 0, dead: 0 });
    expect(send).toHaveBeenCalledWith({ to: "a@b.co", subject: "Hi", text: "Body", html: undefined });
    const [row] = await db.select().from(emailOutbox);
    expect(row!.status).toBe("sent");
  });

  it("dead-letters after max attempts and raises an in-app warning (not an email)", async () => {
    await enqueueFailedEmail({ to: "a@b.co", subject: "Hi", text: "Body" }, "test", "boom", db);
    const send = vi.fn(async () => {
      throw new Error("still down");
    });
    let t = Date.now();
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      t += 48 * 3_600_000;
      await retryEmailOutbox(db, send, new Date(t));
    }
    const [row] = await db.select().from(emailOutbox);
    expect(row!.status).toBe("dead");
    const notes = await db.select().from(notification).where(eq(notification.type, "email_failed"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe("warning");
  });

  it("does not retry before the backoff is due", async () => {
    await enqueueFailedEmail({ to: "a@b.co", subject: "Hi", text: "Body" }, "test", "boom", db);
    const send = vi.fn(async () => ({}));
    expect(await retryEmailOutbox(db, send, new Date())).toEqual({ sent: 0, retried: 0, dead: 0 });
  });
});

// ── health ──────────────────────────────────────────────────────────────
describe("health checks", () => {
  it("flags missing R2 and half-configured Stripe as production failures", () => {
    const checks = configChecks({ VERCEL_ENV: "production", STRIPE_SECRET_KEY: "sk_live_SECRETVALUE123", RESEND_API_KEY: "re_SECRETVALUE456", CRON_SECRET: "cron_SECRETVALUE789", APP_BASE_URL: "https://app.fanzia.io" });
    const byKey = Object.fromEntries(checks.map((c) => [c.key, c.status]));
    expect(byKey.storage_config).toBe("fail");
    expect(byKey.payments_config).toBe("fail");
    expect(byKey.email_config).toBe("ok");
    expect(JSON.stringify(checks)).not.toMatch(/SECRETVALUE/); // never leaks values
  });

  it("heartbeat: never / fresh / stale", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    expect(heartbeatCheck(null, now).status).toBe("warn");
    expect(heartbeatCheck("2026-09-23T02:00:00Z", now).status).toBe("ok");
    expect(heartbeatCheck("2026-09-21T02:00:00Z", now).status).toBe("fail");
  });

  it("full report surfaces overdue refunds and stale heartbeat; public health goes red", async () => {
    const acct = await seedAccount();
    const inv = await seedInvoice(acct.id, []);
    await db.insert(refundDue).values({ invoiceId: inv.id, accountId: acct.id, amountMinor: 5000, reason: "x", createdAt: new Date(Date.now() - 5 * 86_400_000) });
    await setSetting(OPS_SWEEP_HEARTBEAT_KEY, new Date(Date.now() - 3 * 86_400_000).toISOString(), "hb", db);
    const report = await runHealthChecks(db, new Date(), {});
    const byKey = Object.fromEntries(report.checks.map((c) => [c.key, c.status]));
    expect(byKey.database).toBe("ok");
    expect(byKey.refunds).toBe("fail");
    expect(byKey.ops_heartbeat).toBe("fail");
    expect(report.ok).toBe(false);
    expect((await publicHealth(db)).ok).toBe(false);
    await setSetting(OPS_SWEEP_HEARTBEAT_KEY, new Date().toISOString(), "hb", db);
    expect((await publicHealth(db)).ok).toBe(true);
  });
});

// ── drop-cycle automation ───────────────────────────────────────────────
describe("allocation from paid invoices + shortfall refunds", () => {
  it("computeShortfalls: partial fill refunds missing units; zero fill also refunds the fee; never above total", () => {
    const inv = {
      id: "i1",
      accountId: "a1",
      totalMinor: 62500,
      smallOrderFeeMinor: 2500,
      lines: [
        { productId: "p1", sku: "s", name: "Box A", qtyRequested: 4, unitPriceMinor: 10000, lineTotalMinor: 40000, currencyCode: "USD" },
        { productId: "p2", sku: "s", name: "Box B", qtyRequested: 2, unitPriceMinor: 10000, lineTotalMinor: 20000, currencyCode: "USD" },
      ],
    };
    const partial = computeShortfalls(
      [
        { sourceInvoiceId: "i1", productId: "p1", requestedQty: 4, allocatedQty: 3 },
        { sourceInvoiceId: "i1", productId: "p2", requestedQty: 2, allocatedQty: 2 },
      ],
      [inv],
    );
    expect(partial).toEqual([expect.objectContaining({ invoiceId: "i1", amountMinor: 10000 })]);

    const none = computeShortfalls(
      [
        { sourceInvoiceId: "i1", productId: "p1", requestedQty: 4, allocatedQty: 0 },
        { sourceInvoiceId: "i1", productId: "p2", requestedQty: 2, allocatedQty: 0 },
      ],
      [inv],
    );
    expect(none[0]!.amountMinor).toBe(62500);

    expect(computeShortfalls([{ sourceInvoiceId: "i1", productId: "p1", requestedQty: 4, allocatedQty: 4 }], [inv])).toEqual([]);
  });

  async function roundWithPaidOrders() {
    const [sup] = await db.insert(supplier).values({ name: `King Punch ${uid()}` }).returning();
    const [otherSup] = await db.insert(supplier).values({ name: `Other ${uid()}` }).returning();
    const p1 = await seedProduct(10000, { unitsPerCase: 1 });
    const p2 = await seedProduct(10000);
    await db.insert(sourcingRoute).values({ productId: p1.id, supplierId: sup!.id, routeType: "import", confidence: "observed", sourceType: "member_page" });
    await db.insert(sourcingRoute).values({ productId: p2.id, supplierId: otherSup!.id, routeType: "import", confidence: "observed", sourceType: "member_page" });
    const a1 = await seedAccount();
    const a2 = await seedAccount();
    const inv1 = await seedInvoice(a1.id, [line(p1, 6, 10000), line(p2, 2, 10000)]);
    const inv2 = await seedInvoice(a2.id, [line(p1, 4, 10000)]);
    await seedInvoice(a2.id, [line(p1, 9, 10000)], "sent"); // unpaid: must be ignored
    await db.insert(payment).values({ invoiceId: inv1.id, accountId: a1.id, amountMinor: inv1.totalMinor, method: "card", reference: "pi_one", paidAt: new Date(), fundsClearedAt: new Date() });
    await db.insert(payment).values({ invoiceId: inv2.id, accountId: a2.id, amountMinor: inv2.totalMinor, method: "ach", reference: "ach-1", paidAt: new Date(), fundsClearedAt: new Date() });
    const [round] = await db
      .insert(allocationRound)
      .values({ name: "Oct drop", supplierId: sup!.id, policySnapshot: {} })
      .returning();
    return { round: round!, p1, p2, a1, a2, inv1, inv2 };
  }

  it("sync pulls only paid lines for this supplier and is idempotent", async () => {
    const { round, p1 } = await roundWithPaidOrders();
    const first = await syncPaidInvoicesIntoRound(db, round.id, null);
    expect(first.added).toBe(2);
    const again = await syncPaidInvoicesIntoRound(db, round.id, null);
    expect(again.added).toBe(0);
    const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round.id));
    expect(lines.map((l) => l.requestedQty).sort()).toEqual([4, 6]);
    expect(lines.every((l) => l.productId === p1.id && l.sourceInvoiceId)).toBe(true);
  });

  it("settlement auto-refunds cards, leaves ACH for the owner, emails buyers, and is idempotent", async () => {
    const { round, inv1, inv2 } = await roundWithPaidOrders();
    await syncPaidInvoicesIntoRound(db, round.id, null);
    // Supplier filled 7 of 10: 5 of 6 for buyer 1 (card), 2 of 4 for buyer 2 (ACH).
    const lines = await db.select().from(allocationLine).where(eq(allocationLine.roundId, round.id));
    for (const l of lines) {
      await db.update(allocationLine).set({ allocatedQty: l.sourceInvoiceId === inv1.id ? 5 : 2 }).where(eq(allocationLine.id, l.id));
    }
    const refundCard = vi.fn(async () => ({ id: "re_123" }));
    const sendEmail = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const r = await settleRoundShortfalls(db, round.id, { autoRefundCards: true, refundCard, sendEmail, notify });
    expect(r).toMatchObject({ refundsCreated: 2, autoRefunded: 1, pendingManual: 1, failed: 0, totalMinor: 30000 });
    expect(refundCard).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: "pi_one", amountMinor: 10000 }));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);

    const dues = await db.select().from(refundDue);
    const card = dues.find((d) => d.invoiceId === inv1.id)!;
    const ach = dues.find((d) => d.invoiceId === inv2.id)!;
    expect(card).toMatchObject({ status: "refunded", stripeRefundId: "re_123", amountMinor: 10000 });
    expect(ach).toMatchObject({ status: "pending", method: "manual", amountMinor: 20000 });

    const again = await settleRoundShortfalls(db, round.id, { autoRefundCards: true, refundCard, sendEmail, notify });
    expect(again.refundsCreated).toBe(0);
    expect(refundCard).toHaveBeenCalledTimes(1);

    const owner = await seedOwner();
    expect(await markRefundResolved(db, ach.id, owner.id, "ach")).toBe(true);
    expect(await markRefundResolved(db, ach.id, owner.id, "ach")).toBe(false);
  });

  it("a Stripe refund error is recorded as failed and flagged urgent", async () => {
    const { round, inv1 } = await roundWithPaidOrders();
    await syncPaidInvoicesIntoRound(db, round.id, null);
    await db.update(allocationLine).set({ allocatedQty: 0 }).where(eq(allocationLine.sourceInvoiceId, inv1.id));
    const notify = vi.fn(async () => {});
    const r = await settleRoundShortfalls(db, round.id, {
      autoRefundCards: true,
      refundCard: async () => {
        throw new Error("card_declined");
      },
      notify,
    });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ urgent: true }));
    const [due] = await db.select().from(refundDue).where(eq(refundDue.invoiceId, inv1.id));
    expect(due).toMatchObject({ status: "failed", lastError: "card_declined" });
  });

  it("with auto-refund off, card refunds wait for the owner", async () => {
    const { round, inv1 } = await roundWithPaidOrders();
    await syncPaidInvoicesIntoRound(db, round.id, null);
    await db.update(allocationLine).set({ allocatedQty: 1 }).where(eq(allocationLine.sourceInvoiceId, inv1.id));
    const refundCard = vi.fn(async () => ({ id: "re_x" }));
    await settleRoundShortfalls(db, round.id, { autoRefundCards: false, refundCard });
    expect(refundCard).not.toHaveBeenCalled();
    const [due] = await db.select().from(refundDue).where(eq(refundDue.invoiceId, inv1.id));
    expect(due).toMatchObject({ status: "pending", method: "card" });
  });
});

// ── disputes ────────────────────────────────────────────────────────────
describe("card disputes", () => {
  it("puts the account on hold, alerts owners, and blocks auto-approval", async () => {
    await seedOwner();
    const acct = await seedAccount({ taxStatus: "exempt" });
    const p = await seedProduct(10000);
    const inv = await seedInvoice(acct.id, [line(p, 6, 10000)]);
    await db.insert(payment).values({ invoiceId: inv.id, accountId: acct.id, amountMinor: 60000, method: "card", reference: "pi_disputed", paidAt: new Date(), fundsClearedAt: new Date() });

    const event = JSON.stringify({
      id: "evt_d",
      type: "charge.dispute.created",
      data: { object: { id: "dp_1", payment_intent: "pi_disputed", amount: 60000, reason: "fraudulent" } },
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await processStripeWebhook(db, event, null);
    spy.mockRestore();
    expect(res.handled).toBe(true);

    const [held] = await db.select().from(account).where(eq(account.id, acct.id));
    expect(held!.orderingHoldReason).toContain("dp_1");
    const notes = await db.select().from(notification).where(eq(notification.type, "payment_disputed"));
    expect(notes).toHaveLength(1);

    await saveSettings({ order_auto_approve_max_minor: 1_000_000 }, db);
    const buyer = await seedBuyer(acct.id);
    const [req] = await db
      .insert(orderRequest)
      .values({ accountId: acct.id, contactId: buyer.accountContactId, lines: [], subtotalMinor: 60000, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    expect(await autoApproveIfEligible(db, req!.id)).toMatchObject({ approved: false, reason: "account on ordering hold" });
  });
});

// ── analytics ───────────────────────────────────────────────────────────
describe("KPIs", () => {
  it("pure helpers", () => {
    const e = [
      { productId: "p", costMinor: 100, effectiveAt: new Date("2026-01-01") },
      { productId: "p", costMinor: 120, effectiveAt: new Date("2026-06-01") },
    ];
    expect(costAt(e, "p", new Date("2026-03-01"))).toBe(100);
    expect(costAt(e, "p", new Date("2026-07-01"))).toBe(120);
    expect(costAt(e, "p", new Date("2025-12-01"))).toBeNull();
    const gp = grossProfit([{ createdAt: new Date("2026-07-01"), lines: [{ productId: "p", sku: "", name: "", qtyRequested: 2, unitPriceMinor: 150, lineTotalMinor: 300, currencyCode: "USD" }] }], e);
    expect(gp).toEqual({ revenueMinor: 300, costedRevenueMinor: 300, profitMinor: 60 });
    expect(bps(60, 300)).toBe(2000);
    expect(bps(1, 0)).toBeNull();
    const now = new Date("2026-09-23T00:00:00Z");
    const aged = ageReceivables(
      [
        { sentAt: new Date("2026-09-20"), createdAt: new Date("2026-09-20"), balanceMinor: 100 },
        { sentAt: new Date("2026-08-01"), createdAt: new Date("2026-08-01"), balanceMinor: 50 },
        { sentAt: null, createdAt: new Date("2026-09-01"), balanceMinor: 0 },
      ],
      now,
    );
    expect(aged.openMinor).toBe(150);
    expect(aged.buckets[0]).toMatchObject({ minor: 100, count: 1 });
    expect(aged.buckets[3]).toMatchObject({ minor: 50, count: 1 });
    expect(weekStartUtc(new Date("2026-09-23T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(isWorkflowStep("order_request.auto_approved")).toBe(true);
    expect(isWorkflowStep("auth.magic_link_requested")).toBe(false);
  });

  it("computes revenue, margin, automation, funnel and aging from real rows", async () => {
    const now = new Date();
    const acct = await seedAccount();
    const p = await seedProduct(12800, { costMinor: 10000, effectiveAt: new Date(now.getTime() - 30 * 86_400_000) });
    await seedInvoice(acct.id, [line(p, 10, 12800)], "paid");
    await seedInvoice(acct.id, [line(p, 5, 12800)], "sent", { sentAt: new Date(now.getTime() - 40 * 86_400_000) });
    await db.insert(auditLog).values([
      { actorType: "system", action: "order_request.auto_approved", entityType: "order_request" },
      { actorType: "system", action: "invoice.stripe_payment_recorded", entityType: "payment" },
      { actorType: "system", action: "invoice.sent", entityType: "invoice" },
      { actorType: "owner", action: "order_request.approved", entityType: "order_request" },
      { actorType: "owner", action: "auth.magic_link_verified_awaiting_totp", entityType: "user" },
    ]);
    await db.insert(contactMessage).values({ name: "W", email: "w@x.co", message: "waitlist", source: "waitlist" });

    const k = await computeKpis(db, { days: 30, now: new Date(now.getTime() + 1000) });
    expect(k.revenue.invoicedMinor).toBe(15 * 12800);
    expect(k.revenue.grossMarginBps).toBe(2188); // (12800-10000)/12800
    expect(k.revenue.costCoverageBps).toBe(10000);
    expect(k.automation).toMatchObject({ systemSteps: 3, ownerSteps: 1, automationRateBps: 7500, ownerTouches: 1 });
    expect(k.orders.autoApproved).toBe(1);
    expect(k.funnel.waitlist).toBe(1);
    expect(k.receivables.openMinor).toBe(5 * 12800);
    expect(k.receivables.buckets[3]!.count).toBe(1);
    expect(k.weekly).toHaveLength(12);
    expect(k.weekly.reduce((s, w) => s + w.invoicedMinor, 0)).toBe(15 * 12800);
  });
});

describe("weekly digest", () => {
  it("builds a plain-language summary with the queue and system problems", async () => {
    const k = await computeKpis(db, { days: 7 });
    const d = buildDigest(
      k,
      [{ id: "x", priority: 1, kind: "order_review", title: "Review order: Acme, $600.00", detail: "Expires in 5h.", href: "/admin", severity: "urgent" }],
      { ok: false, status: "fail", checkedAt: new Date().toISOString(), checks: [{ key: "k", label: "Document storage", status: "fail", detail: "R2 missing.", fix: "Set R2." }] },
      "https://app.fanzia.io",
    );
    expect(d.subject).toContain("1 thing(s) waiting on you");
    expect(d.text).toContain("Review order: Acme");
    expect(d.text).toContain("[FAIL] Document storage");
    expect(d.text).toContain("https://app.fanzia.io/admin");
    expect(d.text).not.toContain("—");
  });

  it("only sends on the digest day, once per day, to active owners", async () => {
    await seedOwner("g@fanzia.io");
    await seedOwner("j@fanzia.io");
    const send = vi.fn(async () => {});
    const monday = new Date("2026-09-21T15:00:00Z"); // 8am PT Monday
    const tuesday = new Date("2026-09-22T15:00:00Z");
    expect((await maybeSendWeeklyDigest(db, { now: tuesday, enabled: true, day: "monday", baseUrl: "x", send })).sent).toBe(false);
    expect((await maybeSendWeeklyDigest(db, { now: monday, enabled: true, day: "monday", baseUrl: "x", send })).recipients).toBe(2);
    expect((await maybeSendWeeklyDigest(db, { now: monday, enabled: true, day: "monday", baseUrl: "x", send })).reason).toBe("already sent today");
    expect((await maybeSendWeeklyDigest(db, { now: monday, enabled: false, day: "monday", baseUrl: "x", send })).sent).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("decision reminders", () => {
  it("sends one combined reminder per day, only past the threshold", async () => {
    const acct = await seedAccount();
    const buyer = await seedBuyer(acct.id);
    const notify = vi.fn(async () => {});
    const now = new Date();
    await db.insert(orderRequest).values({ accountId: acct.id, contactId: buyer.accountContactId, lines: [], subtotalMinor: 60000, expiresAt: new Date(now.getTime() + 3_600_000) });
    expect((await maybeSendDecisionReminder(db, { now, thresholdHours: 24, notify })).sent).toBe(false); // too fresh
    const later = new Date(now.getTime() + 25 * 3_600_000);
    expect((await maybeSendDecisionReminder(db, { now: later, thresholdHours: 24, notify })).sent).toBe(true);
    expect((await maybeSendDecisionReminder(db, { now: later, thresholdHours: 24, notify })).sent).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("Today queue", () => {
  it("lists what needs an owner, most urgent first, with one-tap actions", async () => {
    const acct = await seedAccount({ orderingHoldReason: "Card dispute dp_9" });
    const buyer = await seedBuyer(acct.id);
    await db.insert(orderRequest).values({ accountId: acct.id, contactId: buyer.accountContactId, lines: [], subtotalMinor: 60000, expiresAt: new Date(Date.now() + 2 * 3_600_000) });
    const inv = await seedInvoice(acct.id, [], "draft");
    await db.insert(refundDue).values({ invoiceId: inv.id, accountId: acct.id, amountMinor: 5000, reason: "shortfall", method: "manual" });
    await db.insert(application).values({
      businessLegalName: "New Shop LLC",
      entityType: "llc",
      formationState: "CA",
      channelType: "retail_store",
      addressLine1: "1 St",
      city: "LA",
      state: "CA",
      postalCode: "90001",
      locationCount: 1,
      expectedMonthlyVolumeUsd: 1000,
      contactName: "N",
      contactEmail: `n-${uid()}@x.co`,
      status: "submitted",
      resumeTokenHash: `rt-${uid()}`,
      resumeTokenExpiresAt: new Date(Date.now() + 86_400_000),
    } as typeof application.$inferInsert);

    const items = await getActionQueue(db);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["order_review", "refund", "invoice_send", "hold", "application_review"]));
    const order = items.find((i) => i.kind === "order_review")!;
    expect(order.severity).toBe("urgent");
    expect(items.indexOf(order)).toBeLessThan(items.findIndex((i) => i.kind === "hold"));
    expect(items.find((i) => i.kind === "refund")!.action!.endpoint).toMatch(/\/resolve$/);
    expect(items.find((i) => i.kind === "hold")!.action!.body).toEqual({ hold: false });
  });
});
