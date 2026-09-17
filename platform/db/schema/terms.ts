import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { account } from "./account";

export const termsDocType = pgEnum("terms_doc_type", [
  "terms_of_sale",
  "privacy_policy",
  "shipping_policy",
  "returns_policy",
  "import_edition_acknowledgment",
]);

/**
 * Published terms are immutable at the database layer (build prompt §12:
 * "not by convention"). Migration 0003 adds a trigger that raises on any
 * UPDATE where published_at IS NOT NULL, and blocks DELETE outright. To
 * "change" published terms, insert a new row with a new version_label.
 */
export const termsVersion = pgTable("terms_version", {
  id: idColumn(),
  docType: termsDocType("doc_type").notNull(),
  versionLabel: text("version_label").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  isDraft: boolean("is_draft").notNull().default(true), // drafts may still be edited pre-publish
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Berman-compliant clickwrap evidence: exact visible language, version,
 * timestamp, IP, user agent, and page context, captured at the moment of
 * acceptance — not reconstructed later from the current terms_version row.
 */
export const termsAcceptance = pgTable("terms_acceptance", {
  id: idColumn(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  termsVersionId: uuid("terms_version_id")
    .notNull()
    .references(() => termsVersion.id),
  visibleLanguageSnapshot: text("visible_language_snapshot").notNull(),
  ip: text("ip").notNull(),
  userAgent: text("user_agent").notNull(),
  pageContext: text("page_context").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});
