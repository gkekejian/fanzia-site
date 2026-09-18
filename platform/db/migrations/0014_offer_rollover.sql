-- Offer rollover policy (track3-rollover): max ONE silent-free auto-rollover
-- per offer; any further expiry requires explicit buyer reacceptance, which
-- creates a fresh offer version (supersedes_id) and marks the old offer
-- superseded. Cancel is always available from submitted/expired.
-- Uses ADD COLUMN IF NOT EXISTS to match the established hand-written
-- migration pattern (0012a/0012b/0012c).
ALTER TABLE "order_request" ADD COLUMN IF NOT EXISTS "rollover_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "order_request" ADD COLUMN IF NOT EXISTS "last_rolled_over_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "order_request" ADD COLUMN IF NOT EXISTS "supersedes_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_request_supersedes_id_fkey'
  ) THEN
    ALTER TABLE "order_request"
      ADD CONSTRAINT "order_request_supersedes_id_fkey"
      FOREIGN KEY ("supersedes_id") REFERENCES "order_request"("id");
  END IF;
END $$;
--> statement-breakpoint
COMMENT ON COLUMN "order_request"."rollover_count" IS 'Silent auto-rollovers consumed; hard cap 1 (MAX_SILENT_ROLLOVERS). Never rolled over silently beyond this — further expiry needs buyer reacceptance.';
--> statement-breakpoint
COMMENT ON COLUMN "order_request"."last_rolled_over_at" IS 'When the single automatic rollover happened; NULL when never rolled over.';
--> statement-breakpoint
COMMENT ON COLUMN "order_request"."supersedes_id" IS 'On a reaccepted fresh offer: the expired offer it replaces (marked superseded).';
