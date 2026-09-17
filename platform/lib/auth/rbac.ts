import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { agentProposal } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { notifyOwners } from "@/lib/notifications";
import type { AuthedUser } from "./session";
import type { AuthedAgent } from "./apiKey";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type Actor =
  | { kind: "owner"; user: AuthedUser }
  | { kind: "ai_operator"; agent: AuthedAgent };

/**
 * Build prompt §14/§14.1 reconciliation note (see PROJECT_SCOPE_FINAL.md
 * and the Phase 1 report to owners for the full reasoning): §14 says every
 * restricted action for an "agent service account" must go through a
 * human-confirmed proposal queue — capability-enforced, not instructed.
 * §14.1 separately describes the named `ai_operator` as "almost god mode."
 * Read together literally, those two sections conflict on whether
 * consequential actions like application approval or terms publication
 * execute immediately for `ai_operator` or must be proposed.
 *
 * This build resolves the conflict conservatively, per the top-level
 * instruction to prefer safe defaults: every action in RESTRICTED_ACTIONS
 * is capability-gated behind agent_proposal for the `ai_operator` API-key
 * actor, full stop, regardless of role labeling. `ai_operator`'s "almost
 * god mode" is expressed instead as: full read access, and direct execute
 * rights on every *non*-restricted admin operation (queue triage,
 * compliance-task management, reporting) with only a normal audit-log
 * entry, no proposal required. Owners can loosen this later by removing
 * actions from this list — a settings-level change, not a rewrite.
 */
export const RESTRICTED_ACTIONS = new Set([
  "application.approve",
  "application.decline",
  "application.tax_determine",
  "terms.publish",
  "account.contact.notify",
  // Phase 2: the only step in the catalog-import pipeline that writes live
  // product/price/route data (build prompt §14: "changing prices,
  // markups..."). Upload, staging, row review, and approve never touch
  // those tables — see lib/catalog/import/service.ts — so only publish
  // needs to be gated here.
  "catalog_import.publish",
]);

/** Absolute — no role, including owner, has a code path for these (build prompt §14.1). */
export function assertNeverAuditMutation(): never {
  throw new Error("The audit log is append-only. No role may update or delete it.");
}

export function assertOwner(actor: Actor, context: string): asserts actor is { kind: "owner"; user: AuthedUser } {
  if (actor.kind !== "owner") {
    throw new ForbiddenError(`${context} requires the owner role (user/role management is owner-only).`);
  }
}

export class ForbiddenError extends Error {}

export function actorUserId(actor: Actor): string {
  return actor.kind === "owner" ? actor.user.id : actor.agent.id;
}

/**
 * Build prompt §14: cost stack (supplier identity, landed cost, markup) is
 * masked at the API layer for any agent scope lacking explicit
 * `cost_stack:read` (test gate #33). Owners always see it; ai_operator only
 * with the explicit scope on its API key (db/schema/user.ts `apiKey.scopes`).
 */
export function canSeeCostStack(actor: Actor): boolean {
  if (actor.kind === "owner") return true;
  return actor.agent.scopes.includes("cost_stack:read");
}

/**
 * Central gate for every mutating admin action. Owners always execute
 * directly (and are audited). ai_operator executes directly for anything
 * not in RESTRICTED_ACTIONS (and is audited); for RESTRICTED_ACTIONS it
 * writes an agent_proposal row instead of running `execute`, and a human
 * owner must decide it later via the admin UI.
 */
export async function performOrPropose<T>(
  actor: Actor,
  action: string,
  entity: { type: string; id?: string | null },
  payload: Record<string, unknown>,
  execute: () => Promise<T>,
  db: AnyDb = defaultDb,
): Promise<{ executed: true; result: T } | { executed: false; proposalId: string }> {
  const isRestrictedForAgent = actor.kind === "ai_operator" && RESTRICTED_ACTIONS.has(action);

  if (isRestrictedForAgent) {
    const agent = (actor as { kind: "ai_operator"; agent: AuthedAgent }).agent;
    const [proposal] = await db
      .insert(agentProposal)
      .values({
        agentUserId: agent.id,
        proposedAction: action,
        payload,
        rationale: (payload.rationale as string) ?? "(no rationale provided)",
      })
      .returning({ id: agentProposal.id });
    await recordAudit(
      {
        actorUserId: agent.id,
        actorRole: "ai_operator",
        actorType: "ai_operator",
        action: `${action}.proposed`,
        entityType: entity.type,
        entityId: entity.id ?? null,
        after: payload,
      },
      db,
    );
    await notifyOwners(
      "Agent proposal awaiting your decision",
      `Muse (ai_operator) attempted "${action}" and it was queued instead of executed.\n\nReview: ${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/agent-proposals`,
      db,
    );
    return { executed: false, proposalId: proposal!.id };
  }

  const result = await execute();
  const actorUserId = actor.kind === "owner" ? actor.user.id : actor.agent.id;
  await recordAudit(
    {
      actorUserId,
      actorRole: actor.kind,
      actorType: actor.kind,
      action,
      entityType: entity.type,
      entityId: entity.id ?? null,
      after: payload,
    },
    db,
  );
  return { executed: true, result };
}
