import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { user } from "./user";

export const agentProposalDecision = pgEnum("agent_proposal_decision", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * The capability-based enforcement mechanism from build prompt §14: an
 * ai_operator-scoped credential can never execute a restricted action
 * directly. It can only write a row here. A human owner must set
 * `decision` before anything downstream happens. No restricted actions
 * exist to propose yet in Phase 1 — this ships the plumbing that Phase 2+
 * mutating features (invoices, POs, pricing, comms) will route through.
 */
export const agentProposal = pgTable("agent_proposal", {
  id: idColumn(),
  agentUserId: uuid("agent_user_id")
    .notNull()
    .references(() => user.id),
  proposedAction: text("proposed_action").notNull(),
  payload: jsonb("payload").notNull(),
  rationale: text("rationale").notNull(),
  decision: agentProposalDecision("decision").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => user.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
