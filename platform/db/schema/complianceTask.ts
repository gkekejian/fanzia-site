import { date, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";

export const complianceTaskKind = pgEnum("compliance_task_kind", [
  "insurance_confirmation",
  "ca_filing",
  "resale_doc_expiry",
  "breach_response_runbook",
  "legal_policy_review",
  "other",
]);

export const complianceTaskStatus = pgEnum("compliance_task_status", ["open", "done"]);

/**
 * Tracks the non-code launch gates from build prompt §15 (insurance,
 * attorney review, CA filings) so they don't get lost between the platform
 * build and the legal/business work the owners do outside it.
 */
export const complianceTask = pgTable("compliance_task", {
  id: idColumn(),
  kind: complianceTaskKind("kind").notNull(),
  status: complianceTaskStatus("status").notNull().default("open"),
  dueDate: date("due_date"),
  notes: text("notes").notNull(),
  ...timestamps,
});
