/**
 * Application submission summary + deterministic checks.
 *
 * George's ask (2026-09-19): "I wish the wholesale application submitted
 * would give me a summary of the business and whether it passes checks."
 * This automates the manual approve/decline briefs: a business summary
 * built from the application fields, plus rule-based checks (no LLM, no
 * scraping — only what the application data itself supports).
 *
 * Pure functions (no DB, no React) so both the submit route (server, for
 * the admin notification email) and the review page (client) share them.
 * Triage score/flags are untouched — this sits alongside them.
 */

export type ApplicationLike = {
  businessLegalName: string;
  channelType: string;
  contactName: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  sellersPermitNumber?: string | null;
  channelEvidenceUrl?: string | null;
  onlinePresence?: string | null;
  productInterests?: unknown;
  emailVerifiedAt?: Date | string | null;
};

export type DocumentLike = {
  docType: string;
  originalFilename: string;
};

export type CheckStatus = "pass" | "fail" | "unknown";

export type ApplicationCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type SummaryRow = { label: string; value: string };

const prettify = (s: string) => s.replace(/_/g, " ");

function interestsList(app: ApplicationLike): string[] {
  const v = app.productInterests;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/**
 * Business summary rows from the application fields + uploaded documents.
 * Mirrors the manual briefs: who they are, where, what they sell, what
 * they want to buy, and what evidence is on file.
 */
export function buildBusinessSummary(app: ApplicationLike, documents: DocumentLike[]): SummaryRow[] {
  const interests = interestsList(app);
  const docTypes = documents.map((d) => prettify(d.docType));
  return [
    { label: "Business", value: app.businessLegalName },
    { label: "Contact", value: `${app.contactName} — ${app.contactEmail}` },
    {
      label: "Location",
      value: [app.addressLine1, app.addressLine2, `${app.city}, ${app.state} ${app.postalCode}`, app.country]
        .filter(Boolean)
        .join(", "),
    },
    { label: "Store type", value: prettify(app.channelType) },
    { label: "Channel evidence", value: app.channelEvidenceUrl || "Not provided" },
    { label: "Online presence", value: app.onlinePresence || "Not provided" },
    { label: "Products of interest", value: interests.length > 0 ? interests.join(", ") : "Not specified" },
    { label: "Seller's permit", value: app.sellersPermitNumber || "Not provided" },
    {
      label: "Documents on file",
      value: documents.length > 0 ? `${documents.length} (${docTypes.join(", ")})` : "None yet",
    },
  ];
}

/**
 * Deterministic checks. Each is pass / fail / unknown:
 * - pass: the evidence is present in the application data.
 * - fail: required and missing.
 * - unknown: optional and missing (can't judge), or not yet verifiable.
 * No external lookups — nothing here scrapes or guesses.
 */
export function runApplicationChecks(app: ApplicationLike, documents: DocumentLike[]): ApplicationCheck[] {
  const hasPermitDoc = documents.some((d) => d.docType === "sellers_permit");
  const interests = interestsList(app);
  return [
    {
      id: "permit_number",
      label: "Seller's permit number provided",
      status: app.sellersPermitNumber ? "pass" : "fail",
      detail: app.sellersPermitNumber
        ? `Provided: ${app.sellersPermitNumber}`
        : "Not provided on the application form.",
    },
    {
      id: "permit_document",
      label: "Seller's permit copy on file",
      status: hasPermitDoc ? "pass" : "fail",
      detail: hasPermitDoc
        ? "A seller's permit document is uploaded."
        : "Required before approval (owner policy) — the applicant can upload it via their status link.",
    },
    {
      id: "channel_evidence",
      label: "Channel evidence link provided",
      status: app.channelEvidenceUrl ? "pass" : "fail",
      detail: app.channelEvidenceUrl ? app.channelEvidenceUrl : "No storefront/marketplace link given.",
    },
    {
      id: "online_presence",
      label: "Online presence described",
      status: app.onlinePresence ? "pass" : "unknown",
      detail: app.onlinePresence ? app.onlinePresence : "Optional — no online sales info given.",
    },
    {
      id: "product_interests",
      label: "Products of interest specified",
      status: interests.length > 0 ? "pass" : "unknown",
      detail: interests.length > 0 ? interests.join(", ") : "Optional — applicant didn't pick product interests.",
    },
    {
      id: "email_verified",
      label: "Contact email verified",
      status: app.emailVerifiedAt ? "pass" : "unknown",
      detail: app.emailVerifiedAt ? "Verified." : "Not yet verified.",
    },
  ];
}

const CHECK_MARK: Record<CheckStatus, string> = { pass: "[PASS]", fail: "[FAIL]", unknown: "[?]" };

/** Plain-text block for the admin notification email. */
export function formatSummaryEmail(
  summary: SummaryRow[],
  checks: ApplicationCheck[],
  triageScore: number,
  needsReviewReasons: unknown,
): string {
  const reasons = Array.isArray(needsReviewReasons) ? needsReviewReasons.filter((r): r is string => typeof r === "string") : [];
  const lines: string[] = [];
  lines.push("Business summary");
  for (const row of summary) lines.push(`- ${row.label}: ${row.value}`);
  lines.push("");
  lines.push(`Triage score: ${triageScore}`);
  if (reasons.length > 0) {
    lines.push("Flags for review:");
    for (const r of reasons) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("Checks");
  for (const c of checks) lines.push(`${CHECK_MARK[c.status]} ${c.label} — ${c.detail}`);
  return lines.join("\n");
}
