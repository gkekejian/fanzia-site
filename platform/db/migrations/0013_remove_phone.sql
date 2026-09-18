-- Phone removal: buyers submit contact via the website only; no phone
-- numbers are collected or stored anywhere in the wholesale platform.
-- Drops every buyer-facing phone column. IF EXISTS guards make this
-- idempotent and safe against databases where a column was never added.
ALTER TABLE "application" DROP COLUMN IF EXISTS "contact_phone";
--> statement-breakpoint
ALTER TABLE "contact_message" DROP COLUMN IF EXISTS "phone";
--> statement-breakpoint
ALTER TABLE "account" DROP COLUMN IF EXISTS "primary_contact_phone";
--> statement-breakpoint
ALTER TABLE "account_contact" DROP COLUMN IF EXISTS "phone";
