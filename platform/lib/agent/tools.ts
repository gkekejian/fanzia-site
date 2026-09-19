import { tool } from "ai";
import { z } from "zod";
import { desc, and, eq, ilike, or, type SQL } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import {
  account,
  agentSuggestion,
  application,
  applicationDocument,
  catalogImport,
  invoice,
  orderRequest,
  product,
} from "@/db/schema";
import { decideApplication } from "@/lib/applications/decide";
import { publishCatalogImport } from "@/lib/catalog/import/service";
import { buildBusinessSummary, runApplicationChecks } from "@/lib/applications/summary";
import type { AuthedUser } from "@/lib/auth/session";
import { logAgentAudit } from "./audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export interface AgentToolContext {
  db?: AnyDb;
  /** The owner driving the chat. The route asserts this; write tools re-check. */
  owner: AuthedUser;
}

function summarize(value: unknown, max = 200): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Builds the tool set for the dashboard chat agent.
 *
 * Read tools execute freely and are audit-logged. Write tools carry
 * `needsApproval: true`, so the AI SDK pauses the agent loop and the chat
 * UI renders an Approve/Decline card; the mutation only runs after the
 * owner approves, in the same authenticated request, with the owner as the
 * actor (the same service functions the direct admin UI calls, so the
 * seller's-permit gate and audit trail apply unchanged).
 */
export function createAgentTools(ctx: AgentToolContext) {
  const db: AnyDb = ctx.db ?? defaultDb;
  const { owner } = ctx;
  const actor = { kind: "owner" as const, user: owner };

  async function auditRead(toolName: string, args: unknown, result: unknown) {
    try {
      await logAgentAudit(
        {
          actorUserId: owner.id,
          actorRole: owner.role,
          tool: toolName,
          args,
          approvalDecision: "executed",
          resultSummary: summarize(result),
        },
        db,
      );
    } catch {
      // Audit logging must never break a tool call.
    }
  }

  const limitSchema = z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max rows to return (1-50).");

  return {
    list_applications: tool({
      description:
        "List wholesale buyer applications. Use to answer 'what applications are waiting', 'show me recent applications', etc.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "submitted", "needs_review", "approved", "declined"])
          .optional()
          .describe("Filter by application status."),
        limit: limitSchema,
      }),
      execute: async ({ status, limit }) => {
        const where: SQL | undefined = status ? eq(application.status, status) : undefined;
        const rows = await db
          .select({
            id: application.id,
            businessLegalName: application.businessLegalName,
            status: application.status,
            triageScore: application.triageScore,
            city: application.city,
            state: application.state,
            hasSellersPermitNumber: application.sellersPermitNumber,
            submittedAt: application.submittedAt,
          })
          .from(application)
          .where(where)
          .orderBy(desc(application.createdAt))
          .limit(limit);
        const out = rows.map((r) => ({
          ...r,
          hasSellersPermitNumber: r.hasSellersPermitNumber != null,
          submittedAt: iso(r.submittedAt),
        }));
        await auditRead("list_applications", { status, limit }, `${out.length} rows`);
        return out;
      },
    }),

    get_application: tool({
      description:
        "Full detail on one application: contact, address, channel evidence, seller's permit number, documents on file, triage score and review reasons, decision state. Also returns a business summary and pass/fail checks.",
      inputSchema: z.object({
        applicationId: z.string().describe("The application id (UUID)."),
      }),
      execute: async ({ applicationId }) => {
        const [app] = await db.select().from(application).where(eq(application.id, applicationId)).limit(1);
        if (!app) {
          await auditRead("get_application", { applicationId }, "not found");
          return { found: false as const };
        }
        const docs = await db
          .select({
            id: applicationDocument.id,
            docType: applicationDocument.docType,
            originalFilename: applicationDocument.originalFilename,
            sizeBytes: applicationDocument.sizeBytes,
            uploadedAt: applicationDocument.uploadedAt,
          })
          .from(applicationDocument)
          .where(eq(applicationDocument.applicationId, applicationId));
        const out = {
          found: true as const,
          id: app.id,
          businessLegalName: app.businessLegalName,
          status: app.status,
          contactName: app.contactName,
          contactEmail: app.contactEmail,
          city: app.city,
          state: app.state,
          channelType: app.channelType,
          channelEvidenceUrl: app.channelEvidenceUrl,
          onlinePresence: app.onlinePresence,
          sellersPermitNumber: app.sellersPermitNumber,
          productInterests: app.productInterests,
          triageScore: app.triageScore,
          needsReviewReasons: app.needsReviewReasons,
          decisionReason: app.decisionReason,
          submittedAt: iso(app.submittedAt),
          documents: docs.map((d) => ({ ...d, uploadedAt: iso(d.uploadedAt) })),
          summary: buildBusinessSummary(app, docs),
          checks: runApplicationChecks(app, docs),
        };
        await auditRead("get_application", { applicationId }, `found: ${app.businessLegalName}`);
        return out;
      },
    }),

    list_products: tool({
      description: "List catalog products (sku, name, status, visibility, msrp). Never invent prices — report msrp as shown or 'unknown'.",
      inputSchema: z.object({
        status: z.enum(["draft", "active", "inactive"]).optional(),
        search: z.string().optional().describe("Substring match on name or SKU."),
        limit: limitSchema,
      }),
      execute: async ({ status, search, limit }) => {
        const conds: SQL[] = [];
        if (status) conds.push(eq(product.status, status));
        if (search) {
          const like = `%${search}%`;
          conds.push(or(ilike(product.name, like), ilike(product.sku, like)) as SQL);
        }
        const rows = await db
          .select({
            id: product.id,
            sku: product.sku,
            name: product.name,
            status: product.status,
            publiclyVisible: product.publiclyVisible,
            msrpMinor: product.msrpMinor,
            packsPerUnit: product.packsPerUnit,
          })
          .from(product)
          .where(conds.length ? (and(...conds) as SQL) : undefined)
          .orderBy(desc(product.createdAt))
          .limit(limit);
        await auditRead("list_products", { status, search, limit }, `${rows.length} rows`);
        return rows;
      },
    }),

    list_catalog_imports: tool({
      description: "List supplier price-list imports and their workflow status (staged/approved/published/rejected).",
      inputSchema: z.object({ limit: limitSchema }),
      execute: async ({ limit }) => {
        const rows = await db
          .select({
            id: catalogImport.id,
            originalFilename: catalogImport.originalFilename,
            status: catalogImport.status,
            rowCount: catalogImport.rowCount,
            createdAt: catalogImport.createdAt,
            publishedAt: catalogImport.publishedAt,
          })
          .from(catalogImport)
          .orderBy(desc(catalogImport.createdAt))
          .limit(limit);
        const out = rows.map((r) => ({ ...r, createdAt: iso(r.createdAt), publishedAt: iso(r.publishedAt) }));
        await auditRead("list_catalog_imports", { limit }, `${out.length} rows`);
        return out;
      },
    }),

    list_order_requests: tool({
      description: "List buyer order requests (status, subtotal, expiry). Lines are summarized, not expanded.",
      inputSchema: z.object({
        status: z.string().optional().describe("Filter by status, e.g. 'submitted'."),
        limit: limitSchema,
      }),
      execute: async ({ status, limit }) => {
        const rows = await db
          .select({
            id: orderRequest.id,
            accountId: orderRequest.accountId,
            status: orderRequest.status,
            subtotalMinor: orderRequest.subtotalMinor,
            expiresAt: orderRequest.expiresAt,
            createdAt: orderRequest.createdAt,
          })
          .from(orderRequest)
          .where(status ? eq(orderRequest.status, status) : undefined)
          .orderBy(desc(orderRequest.createdAt))
          .limit(limit);
        const out = rows.map((r) => ({ ...r, expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt) }));
        await auditRead("list_order_requests", { status, limit }, `${out.length} rows`);
        return out;
      },
    }),

    list_invoices: tool({
      description: "List invoices (number, status, totals).",
      inputSchema: z.object({
        status: z.string().optional().describe("Filter by status, e.g. 'sent', 'paid', 'draft'."),
        limit: limitSchema,
      }),
      execute: async ({ status, limit }) => {
        const rows = await db
          .select({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            subtotalMinor: invoice.subtotalMinor,
            totalMinor: invoice.totalMinor,
            createdAt: invoice.createdAt,
          })
          .from(invoice)
          .where(status ? eq(invoice.status, status) : undefined)
          .orderBy(desc(invoice.createdAt))
          .limit(limit);
        const out = rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
        await auditRead("list_invoices", { status, limit }, `${out.length} rows`);
        return out;
      },
    }),

    search_accounts: tool({
      description: "Search buyer business accounts by legal name.",
      inputSchema: z.object({
        query: z.string().describe("Substring of the account legal name."),
        limit: limitSchema,
      }),
      execute: async ({ query, limit }) => {
        const rows = await db
          .select({
            id: account.id,
            legalName: account.legalName,
            channelType: account.channelType,
            city: account.city,
            state: account.state,
            primaryContactEmail: account.primaryContactEmail,
          })
          .from(account)
          .where(ilike(account.legalName, `%${query}%`))
          .limit(limit);
        await auditRead("search_accounts", { query, limit }, `${rows.length} rows`);
        return rows;
      },
    }),

    list_suggestions: tool({
      description:
        "Read the latest proactive suggestions generated by the daily job: margin alerts, restock ideas, market briefs (what's hot / what's new), ops nudges.",
      inputSchema: z.object({
        kind: z.enum(["margin_alert", "restock_idea", "market_brief", "ops_nudge"]).optional(),
        limit: limitSchema,
      }),
      execute: async ({ kind, limit }) => {
        const rows = await db
          .select({
            id: agentSuggestion.id,
            kind: agentSuggestion.kind,
            title: agentSuggestion.title,
            body: agentSuggestion.body,
            createdAt: agentSuggestion.createdAt,
          })
          .from(agentSuggestion)
          .where(kind ? eq(agentSuggestion.kind, kind) : undefined)
          .orderBy(desc(agentSuggestion.createdAt))
          .limit(limit);
        const out = rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
        await auditRead("list_suggestions", { kind, limit }, `${out.length} rows`);
        return out;
      },
    }),

    approve_application: tool({
      description:
        "Approve a wholesale application (creates the buyer account). Requires the owner to approve in the chat first. Fails if no seller's permit copy is on file — that's owner policy, not a bug.",
      inputSchema: z.object({
        applicationId: z.string().describe("The application id (UUID)."),
        reason: z.string().optional().describe("Short reason recorded with the decision."),
      }),
      needsApproval: true,
      execute: async ({ applicationId, reason }) => {
        const result = await decideApplication(
          { applicationId, decision: "approved", reason, actor },
          db,
        );
        await logAgentAudit(
          {
            actorUserId: owner.id,
            actorRole: owner.role,
            tool: "approve_application",
            args: { applicationId, reason },
            approvalDecision: "granted",
            resultSummary: `approved (buyer account created)`,
          },
          db,
        );
        return { ok: true as const, result: summarize(result) };
      },
    }),

    decline_application: tool({
      description:
        "Decline a wholesale application. Requires the owner to approve in the chat first. Terminal: a declined application cannot be re-decided.",
      inputSchema: z.object({
        applicationId: z.string().describe("The application id (UUID)."),
        reason: z.string().optional().describe("Short reason recorded with the decision."),
      }),
      needsApproval: true,
      execute: async ({ applicationId, reason }) => {
        const result = await decideApplication(
          { applicationId, decision: "declined", reason, actor },
          db,
        );
        await logAgentAudit(
          {
            actorUserId: owner.id,
            actorRole: owner.role,
            tool: "decline_application",
            args: { applicationId, reason },
            approvalDecision: "granted",
            resultSummary: `declined`,
          },
          db,
        );
        return { ok: true as const, result: summarize(result) };
      },
    }),

    publish_catalog_import: tool({
      description:
        "Publish an approved catalog import (writes live product/price/route data). Requires the owner to approve in the chat first. Only imports with status 'approved' can be published.",
      inputSchema: z.object({
        importId: z.string().describe("The catalog import id (UUID)."),
      }),
      needsApproval: true,
      execute: async ({ importId }) => {
        const result = await publishCatalogImport({ importId, actor }, db);
        await logAgentAudit(
          {
            actorUserId: owner.id,
            actorRole: owner.role,
            tool: "publish_catalog_import",
            args: { importId },
            approvalDecision: "granted",
            resultSummary: `published`,
          },
          db,
        );
        return { ok: true as const, result: summarize(result) };
      },
    }),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
