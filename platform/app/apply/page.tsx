import { getLatestPublishedTermsVersion } from "@/lib/terms";
import { DRAFT_POLICIES } from "@/lib/policies/content";
import { ApplyForm } from "@/components/ApplyForm";
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
export default async function ApplyPage() {
  let open = false;
  try {
    open = await areApplicationsOpen();
  } catch {
    // DB unreachable — fail closed, same direction as the API gate.
    open = false;
  }

  if (!open) {
    // Route demand into a queue the owners can batch-process, not a
    // personal inbox. The waitlist form lives on the marketing site and
    // lands in /admin/inbox tagged "waitlist".
    const waitlistUrl = process.env.WAITLIST_URL ?? "https://www.fanzia.io/wholesale#waitlist";
    return (
      <main className="container" style={{ maxWidth: "640px" }}>
        <h1>New wholesale accounts are paused</h1>
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
  return <ApplyForm versionLabel={versionLabel} />;
}
