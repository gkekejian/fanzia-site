import { z } from "zod";
import { normalizeUsState } from "@/lib/geo/usStates";

/**
 * Wholesale application validation (intake hardening, owner policy
 * 2026-09-20): applications must arrive complete. Half-filled submissions
 * that used to need manual follow-up are now rejected at the door.
 *
 * US-only by design: entity types are US entity types only, the business
 * address state and formation state must be US states, and a valid US
 * resale certificate number + copy is required at submit time. Non-US
 * businesses cannot complete the application.
 *
 * Deliberately does not collect an EIN (build prompt §8) — the resale
 * certificate (number + state + uploaded copy) plus the optional
 * secretary-of-state entity number are sufficient for verification while
 * limiting sensitive PII. Fields mirror wholesale-distributor application
 * practice: business identity, entity/formation, address, tax-exemption
 * evidence, shop details, buying intent, and channel evidence.
 *
 * The form posts multipart/form-data (the resale certificate is a file);
 * booleans arrive as "on"/"true"/"1" and numbers as numeric strings, so
 * coercions here accept both JSON and form-data shapes. The file itself is
 * validated in the route (presence, size, sniffed MIME), not here.
 */

/** Accepts true / "true" / "on" / "1" (form-data shapes); rejects everything else. */
const affirmed = z.preprocess(
  (v) => v === true || v === "true" || v === "on" || v === "1",
  z.literal(true, {
    errorMap: () => ({ message: "This must be accepted to submit an application." }),
  }),
);

/** US state code, normalized to uppercase ("ca" -> "CA"). */
const usStateCode = z.preprocess(
  (v) => {
    const code = normalizeUsState(v);
    return code ?? v;
  },
  z.string().length(2, { message: "Select a US state." }).refine((v) => normalizeUsState(v) !== null, {
    message: "Select a US state.",
  }),
);

/** Optional whole number from a form field ("" means not provided). */
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  sole_proprietorship: "Sole proprietorship",
  llc: "LLC",
  corporation: "Corporation (C-corp / S-corp)",
  limited_partnership: "Limited partnership (LP)",
  llp: "Limited liability partnership (LLP)",
};

export const entityTypeSchema = z.enum([
  "sole_proprietorship",
  "llc",
  "corporation",
  "limited_partnership",
  "llp",
]);

/**
 * The exact AI/automation disclosure sentence rendered next to the
 * checkbox on the public application form. Shared by client and server so
 * the language snapshot stored per acceptance is provably the text the
 * applicant saw. The underlying AI data-access policy is pending final
 * legal review (see the DRAFT banner on the form).
 */
export function aiDisclosureLabel(): string {
  return (
    "I understand Fanzia may use automated systems, including artificial intelligence, " +
    "to review this application, and that the information I provide may be processed by " +
    "AI assistants operating under Fanzia's AI data-access policy (currently pending final legal review). " +
    "I consent to that processing."
  );
}

export const applicationSchema = z.object({
  businessLegalName: z.string().min(2).max(200),
  dba: z.string().max(200).optional().default(""),
  entityType: entityTypeSchema,
  formationState: usStateCode,
  sosEntityNumber: z.string().max(60).optional().default(""),
  channelType: z.enum([
    "vending",
    "smoke_shop_convenience",
    "asian_specialty_retail",
    "retail_store",
    "live_seller",
    "event_seller",
    "other",
  ]),
  addressLine1: z.string().min(3).max(200),
  addressLine2: z.string().max(200).optional().default(""),
  city: z.string().min(1).max(100),
  state: usStateCode,
  postalCode: z.string().min(3).max(20),
  // Hard US-only: no free-text country path exists on the form.
  country: z.literal("US").default("US"),
  contactName: z.string().min(2).max(200),
  contactEmail: z.string().email(),
  // Shop scale + buying intent: mandatory for credit/analytics and the
  // approve/decline brief.
  locationCount: z.coerce.number().int().min(1, { message: "Enter at least 1 location." }).max(100000),
  yearsInBusiness: optionalInt(0, 200),
  expectedMonthlyVolumeUsd: z.coerce
    .number()
    .int()
    .min(1, { message: "Enter your expected monthly purchase volume in USD." })
    .max(1000000000),
  // Resale certificate identity — the copy is uploaded at submit time and
  // validated in the route (presence, size, sniffed MIME).
  resaleCertNumber: z.string().min(1, { message: "Enter your resale certificate number." }).max(60),
  resaleCertState: usStateCode,
  channelEvidenceUrl: z.string().url().optional().or(z.literal("")).default(""),
  sellersPermitNumber: z.string().max(60).optional().default(""),
  // What the applicant wants to buy: mandatory so the review brief always
  // shows buying intent.
  productInterests: z
    .array(z.string().max(60))
    .min(1, { message: "Select at least one product you're interested in." })
    .max(20),
  onlinePresence: z.string().max(500).optional().default(""),
  // Typed legal signature certifying the application is true and correct
  // (resale certificates require the purchaser's signature).
  signatureName: z.string().min(2, { message: "Type your full legal name as your signature." }).max(200),
  // Berman-compliant clickwrap: submission is blocked server-side, not
  // just client-side, unless this is explicitly true (build prompt §12).
  termsAccepted: affirmed,
  // AI/automation disclosure: same server-side enforcement as terms.
  aiDisclosureAccepted: affirmed,
  website: z.string().max(0).optional().default(""), // honeypot
  // Cloudflare Turnstile client token. Verified server-side against
  // Cloudflare's siteverify endpoint; fail-open when the secret key is
  // not configured (see lib/turnstile.ts). nullish because the client
  // sends null when the widget is absent or unsolved — rejecting null
  // here would block legitimate applicants while Turnstile is off.
  turnstileToken: z.string().max(2048).nullish().default(""),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;
