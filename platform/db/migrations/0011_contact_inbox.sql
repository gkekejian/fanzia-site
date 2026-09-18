CREATE TABLE IF NOT EXISTS "contact_message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "subject" text,
  "message" text NOT NULL,
  "source" text DEFAULT 'website' NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_message_reply" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "contact_message"("id") ON DELETE CASCADE,
  "author_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_message_status_idx" ON "contact_message" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_message_created_idx" ON "contact_message" USING btree ("created_at" DESC);
