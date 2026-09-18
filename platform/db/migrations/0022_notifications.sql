-- Owner notification center: in-app notifications table backing the admin
-- bell icon + notifications page. Rows are written by notifyOwnersEvent
-- (lib/notifications.ts) at each business event (application submitted,
-- order placed, allocation round created, invoice created/sent/paid,
-- payment failed, shipment shipped/delivered) alongside the existing
-- owner emails. Owner-only visibility is enforced by the API routes and
-- page guard, not by RLS — every admin surface here is already
-- owner-or-ai-operator gated, and the notification rows never leave the
-- owner console.

DO $$ BEGIN
  CREATE TYPE "public"."notification_severity" AS ENUM('info', 'warning');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "actor_email" text,
  "entity_type" text,
  "entity_id" text,
  "severity" "notification_severity" DEFAULT 'info' NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_created_idx" ON "notification" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_unread_idx" ON "notification" ("read_at") WHERE "read_at" IS NULL;
