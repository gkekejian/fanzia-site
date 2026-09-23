import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { account, channelType } from "./account";
import { user } from "./user";

export const applicationStatus = pgEnum("application_status", [
  "draft",
  "submitted",
  "needs_review",
  "approved",
  "declined",
]);

/**
 * US-only entity types accepted for wholesale applications (owner policy
 * 2026-09-20: Fanzia sells only to US-organized businesses with a valid US
 * resale certificate). There is deliberately no "Ltd"/foreign-entity
 * option — non-US businesses cannot complete the application.
 */
export const applicationEntityType = pgEnum("application_entity_type", [
  "sole_proprietorship",
  "llc",
  "corporation",
  "limited_partnership",
  "llp",
]);
/**
 * Scoring sorts the review queue; it never auto-declines or auto-waitlists
 * (build prompt §8: "Replace auto-waitlist decisions with needs_review
 * flags"). There is no code path anywhere that transitions an application
 * to "declined" without an admin actor.
 */
export const application = pgTable("application", {
  id: idColumn(),
  accountId: uuid("account_id").references(() => account.id),
  status: applicationStatus("status").notNull().default("draft"),

  businessLegalName: text("business_legal_name").notNull(),
  // Trade name / DBA, optional — shown on the admin review screen and
  // used for dedupe.
  dba: text("dba"),
  // US-only entity classification (owner policy 2026-09-20). Nullable so
  // pre-2026-09-20 applications still read; required by validation for
  // every new submission.
  entityType: applicationEntityType("entity_type"),
  // US state of incorporation/formation. Validated against the US state
  // list at submit time.
  formationState: text("formation_state"),
  // Secretary-of-state entity number (optional; speeds up verification).
  sosEntityNumber: text("sos_entity_number"),
  channelType: channelType("channel_type").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("US"),

  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),

  channelEvidenceUrl: text("channel_evidence_url"),
  sellersPermitNumber: text("sellers_permit_number"),

  // Shop scale + buying intent (mandatory from 2026-09-20 intake
  // hardening — used for credit/analytics and the review brief).
  locationCount: integer("location_count").notNull().default(1),
  yearsInBusiness: integer("years_in_business"),
  expectedMonthlyVolumeUsd: integer("expected_monthly_volume_usd").notNull().default(0),

  // Resale certificate identity. The certificate *copy* is uploaded at
  // submit time (application_document, doc_type resale_certificate_*);
  // these fields are the number/state written on it.
  resaleCertNumber: text("resale_cert_number"),
  resaleCertState: text("resale_cert_state"),

  // Typed legal signature certifying the application is true and
  // correct (resale certificates require a purchaser signature).
  signatureName: text("signature_name"),

  // AI/automation disclosure acceptance evidence. The disclosure text is
  // owner-finalized (v1, 2026-09-22; no attorney review per owner's direction);
  // the exact visible language is snapshotted here per acceptance.
  aiDisclosureAcceptedAt: timestamp("ai_disclosure_accepted_at", { withTimezone: true }),
  aiDisclosureLanguage: text("ai_disclosure_language"),

  // What the applicant wants to buy (multi-select on the apply form, e.g.
  // Pokémon, Yu-Gi-Oh!, sports cards). Optional; JSON string array.
  productInterests: jsonb("product_interests").notNull().default([]),

  // Where the applicant sells online, if anywhere (Whatnot / TikTok
  // usernames, eBay links, etc.). Optional free text on the apply form.
  onlinePresence: text("online_presence"),

  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  resumeTokenHash: text("resume_token_hash").notNull().unique(),
  resumeTokenExpiresAt: timestamp("resume_token_expires_at", { withTimezone: true }).notNull(),

  triageScore: integer("triage_score").notNull().default(0),
  needsReviewReasons: jsonb("needs_review_reasons").notNull().default([]),

  decidedBy: uuid("decided_by").references(() => user.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),

  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ...timestamps,
});

export const applicationDocumentType = pgEnum("application_document_type", [
  "sellers_permit",
  "resale_certificate_cdtfa230",
  "resale_certificate_other_state",
  "channel_evidence",
  "other",
]);

export const applicationDocument = pgTable("application_document", {
  id: idColumn(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => application.id, { onDelete: "cascade" }),
  docType: applicationDocumentType("doc_type").notNull(),
  storageKey: text("storage_key").notNull(), // random object key; never a guessable path
  originalFilename: text("original_filename").notNull(),
  mimeVerified: text("mime_verified").notNull(), // sniffed from content, not the extension
  sizeBytes: integer("size_bytes").notNull(),
  retentionDeleteAt: timestamp("retention_delete_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationStatusEvent = pgTable("application_status_event", {
  id: idColumn(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => application.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: uuid("actor_user_id").references(() => user.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
