import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { account, accountContact, application, applicationStatusEvent, termsAcceptance } from "@/db/schema";
import { performOrPropose } from "@/lib/auth/rbac";
import type { Actor } from "@/lib/auth/rbac";
import { sendNotificationEmail } from "@/lib/email/send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export class NotFoundError extends Error {}

/**
 * Terminal decisions are final: once an application is approved or declined,
 * it cannot be re-decided (re-approving would resend emails and risk
 * duplicate side effects; flipping approved→declined would orphan the
 * created buyer account). The API maps this to 409.
 */
export class AlreadyDecidedError extends Error {}

import type { ApplicationDecision } from "./decisionReasons";
export type { ApplicationDecision } from "./decisionReasons";

/**
 * One function backs both the direct admin action and re-execution of an
 * approved agent_proposal (app/api/admin/agent-proposals/[id]/decision):
 * calling this with an owner actor always executes immediately; calling it
 * with an ai_operator actor for "approved"/"declined" always defers to
 * agent_proposal instead (build prompt §8/§14 — approval must never be a
 * capability ai_operator holds directly). "needs_review" is queue triage,
 * not an adjudication, so it is not in RESTRICTED_ACTIONS and always
 * executes directly for either actor.
 */
export async function decideApplication(
  input: { applicationId: string; decision: ApplicationDecision; reason?: string; actor: Actor },
  db: AnyDb = defaultDb,
) {
  const [app] = await db.select().from(application).where(eq(application.id, input.applicationId)).limit(1);
  if (!app) throw new NotFoundError("Application not found");
  if (app.status === "approved" || app.status === "declined") {
    throw new AlreadyDecidedError(`Application was already ${app.status} and cannot be re-decided.`);
  }

  const action =
    input.decision === "approved"
      ? "application.approve"
      : input.decision === "declined"
        ? "application.decline"
        : "application.needs_review";

  return performOrPropose(
    input.actor,
    action,
    { type: "application", id: app.id },
    { applicationId: app.id, decision: input.decision, reason: input.reason ?? null },
    async () => {
      const actorUserId = input.actor.kind === "owner" ? input.actor.user.id : input.actor.agent.id;

      if (input.decision === "needs_review") {
        const reasons = Array.isArray(app.needsReviewReasons) ? [...app.needsReviewReasons] : [];
        if (input.reason) reasons.push(input.reason);
        const [updated] = await db
          .update(application)
          .set({ status: "needs_review", needsReviewReasons: reasons })
          .where(eq(application.id, app.id))
          .returning();
        await db.insert(applicationStatusEvent).values({
          applicationId: app.id,
          fromStatus: app.status,
          toStatus: "needs_review",
          actorUserId,
          reason: input.reason ?? null,
        });
        return updated;
      }

      let accountId: string | null = app.accountId ?? null;

      // Accounts are created only on approval (build prompt §8) — approval
      // itself never grants tax exemption; tax_status defaults to
      // "pending" (taxable-safe) until a separate, evidence-gated
      // determination is made (lib/applications/taxDetermine.ts).
      if (input.decision === "approved" && !accountId) {
        const [newAccount] = await db
          .insert(account)
          .values({
            legalName: app.businessLegalName,
            channelType: app.channelType,
            addressLine1: app.addressLine1,
            addressLine2: app.addressLine2,
            city: app.city,
            state: app.state,
            postalCode: app.postalCode,
            country: app.country,
            primaryContactName: app.contactName,
            primaryContactEmail: app.contactEmail,
            createdFromApplicationId: app.id,
          })
          .returning();
        accountId = newAccount!.id;

        // Backfill the clickwrap evidence captured at application time
        // (before the account existed) onto the new account row.
        await db
          .update(termsAcceptance)
          .set({ accountId })
          .where(eq(termsAcceptance.applicationId, app.id));

        // Buyer portal login (Phase 2) authenticates as an account_contact,
        // not the admin `user` table (build prompt §14.1 identities are
        // owner/ai_operator only) — see db/schema/account.ts's comment on
        // accountContact anticipating exactly this wiring, and
        // lib/auth/buyerMagicLink.ts for the login flow it enables.
        await db.insert(accountContact).values({
          accountId,
          name: app.contactName,
          email: app.contactEmail,
          roleOnAccount: "primary",
        });
      }

      const [updated] = await db
        .update(application)
        .set({
          status: input.decision,
          accountId,
          decidedBy: actorUserId,
          decidedAt: new Date(),
          decisionReason: input.reason ?? null,
        })
        .where(eq(application.id, app.id))
        .returning();

      await db.insert(applicationStatusEvent).values({
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: input.decision,
        actorUserId,
        reason: input.reason ?? null,
      });

      const emailBody =
        input.decision === "approved"
          ? `Good news — your Fanzia wholesale application has been approved. We'll be in touch with next steps.${input.reason ? `\n\nNote: ${input.reason}` : ""}`
          : `Thanks for applying to Fanzia wholesale. We're unable to approve your application at this time.${input.reason ? `\n\nReason: ${input.reason}` : ""}`;
      // Best-effort: the decision is already saved above; a failed notice
      // email must not 500 the request (would invite a retried approval).
      await sendNotificationEmail({
        to: app.contactEmail,
        subject: input.decision === "approved" ? "Your Fanzia wholesale application: approved" : "Your Fanzia wholesale application: update",
        text: emailBody,
      }, "application.decision");

      return updated;
    },
    db,
  );
}
