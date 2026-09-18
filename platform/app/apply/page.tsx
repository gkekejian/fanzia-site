import { getLatestPublishedTermsVersion } from "@/lib/terms";
import { DRAFT_POLICIES } from "@/lib/policies/content";
import { ApplyForm } from "@/components/ApplyForm";

/**
 * Server wrapper: resolves the published Terms of Sale version so the
 * clickwrap checkbox label matches the visible-language snapshot recorded
 * by the applications API (lib/policies/clickwrap.ts). Falls back to the
 * static draft label only if the DB is unreachable.
 */
export default async function ApplyPage() {
  let versionLabel = DRAFT_POLICIES.terms_of_sale.versionLabel;
  try {
    const row = await getLatestPublishedTermsVersion("terms_of_sale");
    if (row) versionLabel = row.versionLabel;
  } catch {
    // DB unreachable — the client form still works with the draft label.
  }
  return <ApplyForm versionLabel={versionLabel} />;
}
