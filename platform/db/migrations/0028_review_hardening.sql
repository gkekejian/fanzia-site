-- Review hardening (2026-09-23).
--
-- 1. Stripe idempotency at the database layer. recordCardPaymentFromStripe
--    deduped with SELECT-then-INSERT, which two concurrent webhook
--    deliveries for the same PaymentIntent can both pass. A partial unique
--    index makes the second insert a no-op (ON CONFLICT DO NOTHING).
--    Scoped to card payments only: manual ACH/wire rows may legitimately
--    share free-text references.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_card_reference_uniq"
  ON "payment" ("invoice_id", "reference")
  WHERE "method" = 'card' AND "reference" IS NOT NULL;
--> statement-breakpoint
-- 2. Shared rate-limit buckets. The in-memory Map in lib/rateLimit.ts is
--    per serverless instance, so limits were never actually enforced on
--    Vercel. UNLOGGED: fast, not WAL-logged, contents may be lost on a
--    crash, which is acceptable for rate-limit counters.
CREATE UNLOGGED TABLE IF NOT EXISTS "rate_limit_bucket" (
  "key" text PRIMARY KEY,
  "count" integer NOT NULL,
  "reset_at" timestamp with time zone NOT NULL
);
