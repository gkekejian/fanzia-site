import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./common";
import { accountContact, account } from "./account";

/**
 * Buyer-side auth, deliberately separate from the owner/ai_operator
 * `user`/`session` tables (build prompt §14.1's identities are admin-only —
 * see the comment on `accountContact` in db/schema/account.ts: "Buyer
 * portal login is a later-phase concern"). Phase 2 is that later phase: the
 * public/member catalog split (test gate #1) needs a real authentication
 * boundary, not a client-side flag, so a buyer signs in as an
 * `account_contact` via magic link — no TOTP, matching the build prompt's
 * buyer-side simplicity (only owners get MFA).
 */
export const buyerMagicLink = pgTable("buyer_magic_link", {
  id: idColumn(),
  accountContactId: uuid("account_contact_id")
    .notNull()
    .references(() => accountContact.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const buyerSession = pgTable("buyer_session", {
  id: idColumn(),
  accountContactId: uuid("account_contact_id")
    .notNull()
    .references(() => accountContact.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
