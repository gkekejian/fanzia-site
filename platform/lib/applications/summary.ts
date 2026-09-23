import { ENTITY_TYPE_LABELS } from "@/lib/validation/application";
import { TRIAGE_MAX_SCORE, triageBand } from "./triage";

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
  dba?: string | null;
  entityType?: string | null;
  formationState?: string | null;
  sosEntityNumber?: string | null;
  channelType: string;
  contactName: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  locationCount?: number | null;
  yearsInBusiness?: number | null;
  expectedMonthlyVolumeUsd?: number | null;
  resaleCertNumber?: string | null;
  resaleCertState?: string | null;
  signatureName?: string | null;
  aiDisclosureAcceptedAt?: Date | string | null;
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

function entityLabel(entityType?: string | null): string {
  if (!entityType) return "Not collected (legacy application)";
  return ENTITY_TYPE_LABELS[entityType] ?? prettify(entityType);
}

/**
 * Non-US entity suffixes. Fanzia sells wholesale only to US-organized
 * businesses; a name ending in one of these (e.g. "Good Morrow Tavern
 * LTD") is a strong signal the applicant is not a US entity and needs a
 * second look before any approval.
 */
const FOREIGN_ENTITY_SUFFIX = /\b(ltd|plc|pty|gmbh|sarl|sas|bv|aps|oy|nv|ag|sdn|bhd)\.?$/i;

export function hasForeignEntitySuffix(businessLegalName: string): boolean {
  return FOREIGN_ENTITY_SUFFIX.test(businessLegalName.trim());
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
    { label: "DBA", value: app.dba || "None" },
    { label: "Entity type", value: entityLabel(app.entityType) },
    { label: "Formation state", value: app.formationState || "Not collected (legacy application)" },
    { label: "Contact", value: `${app.contactName} — ${app.contactEmail}` },
    {
      label: "Location",
      value: [app.addressLine1, app.addressLine2, `${app.city}, ${app.state} ${app.postalCode}`, app.country]
        .filter(Boolean)
        .join(", "),
    },
    { label: "Store type", value: prettify(app.channelType) },
    { label: "Locations", value: app.locationCount != null ? String(app.locationCount) : "Not collected" },
    {
      label: "Years in business",
      value: app.yearsInBusiness != null ? String(app.yearsInBusiness) : "Not provided",
    },
    {
      label: "Expected monthly volume",
      value: app.expectedMonthlyVolumeUsd != null && app.expectedMonthlyVolumeUsd > 0
        ? fmtUsd(app.expectedMonthlyVolumeUsd)
        : "Not collected",
    },
    {
      label: "Resale certificate",
      value:
        app.resaleCertNumber
          ? `${app.resaleCertNumber}${app.resaleCertState ? ` (${app.resaleCertState})` : ""}`
          : "Not provided",
    },
    { label: "Channel evidence", value: app.channelEvidenceUrl || "Not provided" },
    { label: "Online presence", value: app.onlinePresence || "Not provided" },
    { label: "Products of interest", value: interests.length > 0 ? interests.join(", ") : "Not specified" },
    { label: "Seller's permit", value: app.sellersPermitNumber || "Not provided" },
    { label: "Signed by", value: app.signatureName || "Not collected (legacy application)" },
    {
      label: "AI disclosure",
      value: app.aiDisclosureAcceptedAt ? "Accepted" : "Not collected (legacy application)",
    },
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
  const hasResaleCertDoc = documents.some((d) => d.docType.startsWith("resale_certificate"));
  const interests = interestsList(app);
  const foreignSuffix = hasForeignEntitySuffix(app.businessLegalName);
  return [
    {
      id: "us_entity",
      label: "US-organized entity",
      status: foreignSuffix ? "fail" : app.entityType && app.formationState ? "pass" : "unknown",
      detail: foreignSuffix
        ? `Business name ends in a non-US entity suffix ("${app.businessLegalName.trim().split(/\s+/).pop()}") — verify this is actually a US entity before approving.`
        : app.entityType && app.formationState
          ? `${entityLabel(app.entityType)}, formed in ${app.formationState}.`
          : "Entity info not collected (application predates the 2026-09-20 intake requirements).",
    },
    {
      id: "resale_cert_document",
      label: "Resale certificate copy on file",
      status: hasResaleCertDoc ? "pass" : "fail",
      detail: hasResaleCertDoc
        ? `Uploaded${app.resaleCertNumber ? ` — ${app.resaleCertNumber}${app.resaleCertState ? ` (${app.resaleCertState})` : ""}` : ""}.`
        : "Required at submission since 2026-09-20 — the applicant must re-submit with the certificate attached.",
    },
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
  lines.push(`Review flags: ${triageScore} of ${TRIAGE_MAX_SCORE} (${triageBand(triageScore).label})`);
  if (reasons.length > 0) {
    lines.push("Flags for review:");
    for (const r of reasons) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("Checks");
  for (const c of checks) lines.push(`${CHECK_MARK[c.status]} ${c.label} — ${c.detail}`);
  return lines.join("\n");
}
