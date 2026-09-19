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
