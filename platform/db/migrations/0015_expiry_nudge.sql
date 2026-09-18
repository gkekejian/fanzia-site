-- Ops sweep (offer expiry cron): 24h pre-expiry nudge dedupe.
-- expiry_nudge_sent_at on order_request records when the buyer was sent the
-- "offer expires soon" reminder for the current expiry window; NULL means
-- never nudged. The sweep sets it only after a successful send, so a failed
-- send leaves it NULL and the next sweep retries the offer instead of
-- skipping it forever. A reaccepted offer is a fresh row (new expiry
-- window), so it may legitimately be nudged again.
-- Uses ADD COLUMN IF NOT EXISTS to match the established hand-written
-- migration pattern (0012a/0012b/0012c, 0014).
ALTER TABLE "order_request" ADD COLUMN IF NOT EXISTS "expiry_nudge_sent_at" timestamp with time zone;
--> statement-breakpoint
COMMENT ON COLUMN "order_request"."expiry_nudge_sent_at" IS 'When the buyer was sent the 24h pre-expiry nudge for the current expiry window; NULL when never nudged. Set only after a successful send so failures retry on the next sweep.';
