-- Fanzia-as-client (design doc 2026-09-18 §1.1): buyer_kind on account.
-- 'internal' marks Fanzia's own vending buyer ("Fanzia Vending —
-- Internal"); every other buyer is 'external'. Internal rows skip the $25
-- sub-$750 small-order fee and are excluded from buyer-facing aggregate
-- stats, but compete in the same allocation math as external rows.
-- Default 'external' so existing accounts need no backfill.
-- Uses a guarded CREATE TYPE (no plain IF NOT EXISTS for types on older
-- Postgres) plus the established ADD COLUMN IF NOT EXISTS /
-- statement-breakpoint pattern (0015).
DO $$ BEGIN
  CREATE TYPE "public"."account_kind" AS ENUM('internal', 'external');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "kind" "account_kind" NOT NULL DEFAULT 'external';
--> statement-breakpoint
COMMENT ON COLUMN "account"."kind" IS 'Buyer kind: internal = Fanzia own vending restock buyer (no small-order fee, excluded from buyer-facing stats); external = every customer. Default external.';
--> statement-breakpoint
