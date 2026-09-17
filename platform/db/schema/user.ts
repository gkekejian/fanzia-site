import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";

/**
 * Only two roles exist for platform admin identities (build prompt §14.1).
 * "owner" is unrestricted except audit-log immutability. "ai_operator" is
 * everything an owner can do except user/role management and touching the
 * audit log — enforced in lib/auth/rbac.ts, not by this enum alone.
 */
export const userRole = pgEnum("user_role", ["owner", "ai_operator"]);

export const user = pgTable("user", {
  id: idColumn(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable("session", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Magic-link login tokens. Raw token only ever appears in the emailed URL. */
export const magicLink = pgTable("magic_link", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const totpCredential = pgTable("totp_credential", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  secretEncrypted: text("secret_encrypted").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryCode = pgTable("recovery_code", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ai_operator's credential type (build prompt §14.1: "API keys are the
 * AI's credential type", no TOTP). Displayed once at creation, stored only
 * as a hash from then on. Scopes default to read-only; cost_stack:read
 * must be explicit.
 */
export const apiKey = pgTable("api_key", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(), // shown in UI for identification, never the secret
  scopes: text("scopes").array().notNull().default(["read"]),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => user.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
