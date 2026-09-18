import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";

/**
 * A contact-form submission from the marketing site. This is the website
 * inbox: visitors submit, the team reads and replies from /admin/inbox.
 * Statuses: new → open → replied → closed (closed is terminal-ish, can be
 * reopened to open).
 */
export const contactMessage = pgTable("contact_message", {
  id: idColumn(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  subject: text("subject"),
  message: text("message").notNull(),
  source: text("source").notNull().default("website"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Replies on a contact message thread. Replies are written by staff in the
 * admin inbox and delivered to the visitor by email; the stored copy is the
 * record of what was sent.
 */
export const contactMessageReply = pgTable("contact_message_reply", {
  id: idColumn(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => contactMessage.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
