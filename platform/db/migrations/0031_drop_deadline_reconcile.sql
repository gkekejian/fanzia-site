-- Reconcile allocation_drop with the final shape of migration 0030.
-- 0030 was edited before release (rolling offer windows became one
-- offers-close deadline per drop). Production only ever ran the final
-- version, but this makes both shapes converge so a database that ran the
-- earlier draft can never be left behind. Idempotent: a no-op on a
-- database that already has the final columns.
ALTER TABLE "allocation_drop" ADD COLUMN IF NOT EXISTS "offers_close_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "allocation_drop" ADD COLUMN IF NOT EXISTS "lead_time_min_days" integer NOT NULL DEFAULT 10;
--> statement-breakpoint
ALTER TABLE "allocation_drop" ADD COLUMN IF NOT EXISTS "lead_time_max_days" integer NOT NULL DEFAULT 15;
--> statement-breakpoint
ALTER TABLE "allocation_drop" DROP COLUMN IF EXISTS "offer_window_hours";
--> statement-breakpoint
ALTER TABLE "allocation_drop" DROP COLUMN IF EXISTS "reoffer_window_hours";
