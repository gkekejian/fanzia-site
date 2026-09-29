import { getLatestPublishedTermsVersion } from "@/lib/terms";
import { DRAFT_POLICIES } from "@/lib/policies/content";
import { ApplyForm, type ApplyInvite } from "@/components/ApplyForm";
import { db } from "@/db/client";
import { findInvite, inviteProblem } from "@/lib/applications/invites";
import { areApplicationsOpen } from "@/lib/applications/portal";

/**
 * Server wrapper: resolves the published Terms of Sale version so the
 * clickwrap checkbox label matches the visible-language snapshot recorded
 * by the applications API (lib/policies/clickwrap.ts). Falls back to the
 * static draft label only if the DB is unreachable.
 *
 * When the portal kill switch is closed (owner directive 2026-09-23), the
 * form is replaced with a closed notice — in-flight applicants keep using
 * their status-link continue pages.
 */
export default async function ApplyPage({ searchParams }: { searchParams?: { invite?: string | string[] } }) {
  let open = false;
  try {
    open = await areApplicationsOpen();
  } catch {
    // DB unreachable — fail closed, same direction as the API gate.
    open = false;
  }

  // Personal invite (docs/allocation-design.md §9): lets one person apply
  // while the portal is closed. Checked again, and consumed, by the API.
  const rawInvite = typeof searchParams?.invite === "string" ? searchParams.invite.slice(0, 64) : null;
  let invite: ApplyInvite | null = null;
  let inviteError: string | null = null;
  if (rawInvite) {
    try {
      const found = await findInvite(db, rawInvite);
      inviteError = inviteProblem(found);
      if (!inviteError && found) invite = { code: rawInvite, email: found.invite.email, name: found.invite.name };
    } catch {
      inviteError = "We couldn't check your invite right now. Please try again in a few minutes.";
    }
  }

  if (!open && !invite) {
    // Route demand into a queue the owners can batch-process, not a
    // personal inbox. The waitlist form lives on the marketing site and
    // lands in /admin/inbox tagged "waitlist".
    const waitlistUrl = process.env.WAITLIST_URL ?? "https://www.fanzia.io/wholesale#waitlist";
    return (
      <main className="container" style={{ maxWidth: "640px" }}>
        <h1>New wholesale accounts are paused</h1>
        {inviteError && (
          <p className="field-error" role="alert">
            {inviteError}
          </p>
        )}
        <p>
          We onboard buyers in small batches so every approved account gets product. Join the waitlist and
          we&rsquo;ll email you when the next batch opens. It takes 20 seconds.
        </p>
        <p>
          <a className="btn" href={waitlistUrl}>
            Join the waitlist
          </a>
        </p>
        <p style={{ fontSize: "0.9em" }}>
          Already applied? Your status link from the confirmation email still works.
        </p>
      </main>
    );
  }

  let versionLabel = DRAFT_POLICIES.terms_of_sale.versionLabel;
  try {
    const row = await getLatestPublishedTermsVersion("terms_of_sale");
    if (row) versionLabel = row.versionLabel;
  } catch {
    // DB unreachable — the client form still works with the draft label.
  }
  return <ApplyForm versionLabel={versionLabel} invite={invite} />;
}
