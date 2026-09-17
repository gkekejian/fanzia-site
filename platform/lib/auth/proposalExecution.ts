import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { decideApplication } from "@/lib/applications/decide";
import { determineTax } from "@/lib/applications/taxDetermine";
import { publishCatalogImport } from "@/lib/catalog/import/service";
import type { AuthedUser } from "./session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Runs the real mutation behind an agent_proposal once an owner approves
 * it, reusing the exact same service function the direct admin action
 * calls (lib/applications/decide.ts, lib/applications/taxDetermine.ts).
 * The actor passed in is always the deciding owner, never the original
 * ai_operator, so performOrPropose executes immediately instead of
 * creating a second proposal.
 */
export async function executeApprovedProposal(
  proposal: { proposedAction: string; payload: Record<string, unknown> },
  decidingOwner: AuthedUser,
  db: AnyDb = defaultDb,
) {
  const actor = { kind: "owner" as const, user: decidingOwner };
  const payload = proposal.payload;

  switch (proposal.proposedAction) {
    case "application.approve":
      return decideApplication(
        { applicationId: payload.applicationId as string, decision: "approved", reason: (payload.reason as string) ?? undefined, actor },
        db,
      );
    case "application.decline":
      return decideApplication(
        { applicationId: payload.applicationId as string, decision: "declined", reason: (payload.reason as string) ?? undefined, actor },
        db,
      );
    case "application.tax_determine":
      return determineTax(
        {
          accountId: payload.accountId as string,
          status: payload.status as "exempt" | "taxable",
          evidenceObjectKey: (payload.evidenceObjectKey as string | null) ?? null,
          notes: payload.notes as string,
          actor,
        },
        db,
      );
    case "catalog_import.publish":
      return publishCatalogImport({ importId: payload.importId as string, actor }, db);
    default:
      throw new Error(`Execution of proposed action "${proposal.proposedAction}" is not implemented.`);
  }
}
