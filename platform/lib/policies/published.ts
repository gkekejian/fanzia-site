import { getLatestPublishedTermsVersion, type TermsDocType } from "@/lib/terms";
import { DRAFT_POLICIES } from "@/lib/policies/content";

/**
 * Props for the public policy pages. Reads the current published
 * terms_version row — the same version buyers actually accept — and falls
 * back to the static DRAFT_POLICIES module only when the DB is unreachable
 * or no published row exists yet.
 */
export async function getPolicyPageProps(docType: TermsDocType): Promise<{ title: string; body: string }> {
  try {
    const row = await getLatestPublishedTermsVersion(docType);
    if (row) {
      return { title: DRAFT_POLICIES[docType].title, body: row.bodyMarkdown };
    }
  } catch {
    // DB unreachable — fall through to the static draft below.
  }
  const draft = DRAFT_POLICIES[docType];
  return { title: draft.title, body: draft.body };
}
