import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import {
  account,
  accountContact,
  agentAuditLog,
  agentSuggestion,
  application,
  orderRequest,
  product,
  productPricingFlag,
} from "@/db/schema";
import { logAgentAudit } from "@/lib/agent/audit";
import { createAgentTools } from "@/lib/agent/tools";
import { generateAgentSuggestions } from "@/lib/agent/suggestions";
import type { AuthedUser } from "@/lib/auth/session";

const OWNER: AuthedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  name: "Test Owner",
  role: "owner",
};

// The AI SDK execute options type is complex; cast at the call site.
const execOpts = { toolCallId: "test-call", messages: [] } as never;

describe("dashboard AI operator", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();
    const { db } = ctx;
    await db.insert(account).values({
      id: "22222222-2222-4222-8222-222222222222",
      legalName: "Test Buyer LLC",
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Buyer",
      primaryContactEmail: "buyer@example.com",
    });
    await db.insert(accountContact).values({
      accountId: "22222222-2222-4222-8222-222222222222",
      name: "Buyer",
      email: "buyer@example.com",
    });
  });

  it("logAgentAudit writes a row to agent_audit_log", async () => {
    const { db } = ctx;
    await logAgentAudit(
      { tool: "list_applications", args: { limit: 5 }, approvalDecision: "executed", resultSummary: "2 rows" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
    );
    const rows = await db.select().from(agentAuditLog).where(eq(agentAuditLog.tool, "list_applications"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.approvalDecision).toBe("executed");
    expect(rows[0]?.resultSummary).toBe("2 rows");
    expect(rows[0]?.arguments).toEqual({ limit: 5 });
  });

  it("write tools are approval-gated from day one", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = createAgentTools({ owner: OWNER, db: ctx.db as any }) as any;
    expect(tools.approve_application.needsApproval).toBe(true);
    expect(tools.decline_application.needsApproval).toBe(true);
    expect(tools.publish_catalog_import.needsApproval).toBe(true);
    // Read tools execute freely (no approval gate).
    expect(tools.list_applications.needsApproval ?? false).toBe(false);
    expect(tools.list_products.needsApproval ?? false).toBe(false);
  });

  it("list_applications read tool returns rows and audits itself", async () => {
    const { db } = ctx;
    await db.insert(application).values({
      businessLegalName: "Audit Test Shop LLC",
      channelType: "other",
      addressLine1: "9 Test Ave",
      city: "Burbank",
      state: "CA",
      postalCode: "91502",
      contactName: "Sam",
      contactEmail: "sam@example.com",
      resumeTokenHash: "hash-audit-test",
      resumeTokenExpiresAt: new Date(Date.now() + 86400000),
      status: "submitted",
      submittedAt: new Date(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = createAgentTools({ owner: OWNER, db: db as any }) as any;
    const rows = await tools.list_applications.execute({ limit: 20 }, execOpts);
    expect(rows.some((r: { businessLegalName: string }) => r.businessLegalName === "Audit Test Shop LLC")).toBe(true);
    const audits = await db.select().from(agentAuditLog).where(eq(agentAuditLog.tool, "list_applications"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("generateAgentSuggestions emits a review-queue nudge and dedupes", async () => {
    const { db } = ctx;
    await db.insert(application).values({
      businessLegalName: "Stale Application Co",
      channelType: "other",
      addressLine1: "3 Old Rd",
      city: "Pasadena",
      state: "CA",
      postalCode: "91101",
      contactName: "Pat",
      contactEmail: "pat@example.com",
      resumeTokenHash: "hash-stale-app",
      resumeTokenExpiresAt: new Date(Date.now() + 86400000),
      status: "submitted",
      submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await generateAgentSuggestions(db as any, new Date());
    expect(first.inserted).toBeGreaterThanOrEqual(1);
    expect(first.byKind.ops_nudge).toBeGreaterThanOrEqual(1);
    const nudges = await db.select().from(agentSuggestion).where(eq(agentSuggestion.kind, "ops_nudge"));
    expect(nudges.some((n) => n.title.includes("waiting over 48h"))).toBe(true);
    // Second run same day: review-queue nudge dedupes (may still insert nothing new).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await generateAgentSuggestions(db as any, new Date());
    const again = await db.select().from(agentSuggestion).where(eq(agentSuggestion.kind, "ops_nudge"));
    expect(again.filter((n) => n.title.includes("waiting over 48h")).length).toBe(
      nudges.filter((n) => n.title.includes("waiting over 48h")).length,
    );
    expect(second.inserted).toBeLessThanOrEqual(first.inserted);
  });

  it("generateAgentSuggestions builds a what's-hot brief from order lines", async () => {
    const { db } = ctx;
    const [contact] = await db.select({ id: accountContact.id }).from(accountContact).limit(1);
    const [prod] = await db
      .insert(product)
      .values({
        sku: "HOT-SKU-1",
        name: "Hot Booster Box",
        editionLanguage: "EN",
        origin: "US",
        condition: "sealed",
        packsPerUnit: 36,
        releaseStatus: "released",
        descriptionOriginal: "test",
        status: "active",
        publiclyVisible: true,
      })
      .returning({ id: product.id });
    await db.insert(orderRequest).values({
      accountId: "22222222-2222-4222-8222-222222222222",
      contactId: contact!.id,
      lines: [{ productId: prod!.id, sku: "HOT-SKU-1", name: "Hot Booster Box", qtyRequested: 10, unitPriceMinor: 1000, lineTotalMinor: 10000, currencyCode: "USD" }],
      subtotalMinor: 10000,
      status: "submitted",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { byKind } = await generateAgentSuggestions(db as any, new Date());
    expect(byKind.market_brief).toBeGreaterThanOrEqual(1);
    const briefs = await db.select().from(agentSuggestion).where(eq(agentSuggestion.kind, "market_brief"));
    expect(briefs.some((b) => b.body.includes("Hot Booster Box"))).toBe(true);
  });

  it("generateAgentSuggestions flags estimated pricing as a margin alert", async () => {
    const { db } = ctx;
    const [prod] = await db
      .insert(product)
      .values({
        sku: "EST-SKU-1",
        name: "Estimated Price Pack",
        editionLanguage: "EN",
        origin: "US",
        condition: "sealed",
        packsPerUnit: 36,
        releaseStatus: "released",
        descriptionOriginal: "test",
        status: "active",
        publiclyVisible: true,
      })
      .returning({ id: product.id });
    await db.insert(productPricingFlag).values({ productId: prod!.id, isReal: "estimated" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { byKind } = await generateAgentSuggestions(db as any, new Date());
    expect(byKind.margin_alert).toBeGreaterThanOrEqual(1);
    const alerts = await db.select().from(agentSuggestion).where(eq(agentSuggestion.kind, "margin_alert"));
    expect(alerts.some((a) => a.title.includes("EST-SKU-1"))).toBe(true);
  });
});
