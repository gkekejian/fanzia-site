import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { account, taxDetermination } from "@/db/schema";
import { performOrPropose } from "@/lib/auth/rbac";
import type { Actor } from "@/lib/auth/rbac";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

/**
 * Deliberately a separate action from application approval (build prompt
 * §8: approval must never grant tax exemption). Evidence is required for
 * an "exempt" determination *before* performOrPropose runs, so the rule
 * applies equally to a direct owner action and to an ai_operator proposal
 * — a proposal can never even be queued for a claim with no evidence
 * attached, since the payload itself would be invalid.
 */
export async function determineTax(
  input: {
    accountId: string;
    status: "exempt" | "taxable";
    evidenceObjectKey?: string | null;
    notes: string;
    actor: Actor;
  },
  db: AnyDb = defaultDb,
) {
  const [acct] = await db.select().from(account).where(eq(account.id, input.accountId)).limit(1);
  if (!acct) throw new NotFoundError("Account not found");

  if (input.status === "exempt" && !input.evidenceObjectKey) {
    throw new ValidationError(
      "A tax-exempt determination requires verification evidence (an uploaded resale certificate or equivalent).",
    );
  }

  return performOrPropose(
    input.actor,
    "application.tax_determine",
    { type: "account", id: acct.id },
    {
      accountId: acct.id,
      status: input.status,
      evidenceObjectKey: input.evidenceObjectKey ?? null,
      notes: input.notes,
    },
    async () => {
      const actorUserId = input.actor.kind === "owner" ? input.actor.user.id : input.actor.agent.id;
      const [determination] = await db
        .insert(taxDetermination)
        .values({
          accountId: acct.id,
          status: input.status,
          evidenceObjectKey: input.evidenceObjectKey ?? null,
          notes: input.notes,
          determinedBy: actorUserId,
        })
        .returning();
      await db.update(account).set({ taxStatus: input.status }).where(eq(account.id, acct.id));
      return determination;
    },
    db,
  );
}
