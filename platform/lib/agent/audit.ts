import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { agentAuditLog } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type AgentApprovalDecision = "executed" | "requested" | "granted" | "denied";

/**
 * Writes one row to agent_audit_log. Fire-and-forget safe: audit logging
 * must never break a tool call, so callers should let this throw only in
 * tests. Production call sites await it inside their own try/catch.
 */
export async function logAgentAudit(
  entry: {
    actorUserId?: string | null;
    actorRole?: string | null;
    tool: string;
    args: unknown;
    approvalDecision?: AgentApprovalDecision;
    resultSummary?: string | null;
  },
  db: AnyDb = defaultDb,
) {
  await db.insert(agentAuditLog).values({
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    tool: entry.tool,
    arguments: entry.args ?? {},
    approvalDecision: entry.approvalDecision ?? "executed",
    resultSummary: entry.resultSummary ?? null,
  });
}
