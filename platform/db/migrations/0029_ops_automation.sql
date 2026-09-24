-- Ops automation & contingencies (2026-09-23, second review pass).

-- Case-only selling: when set and case-only mode is on, buyers order in
-- multiples of this many units (no repacking in Glendale).
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "units_per_case" integer;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_units_per_case_positive"
  CHECK ("units_per_case" IS NULL OR "units_per_case" > 0);
--> statement-breakpoint

-- Account ordering hold: set automatically on a card dispute (chargeback)
-- or by an owner; blocks new order submission and auto-approval.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "ordering_hold_reason" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "ordering_hold_at" timestamp with time zone;
--> statement-breakpoint

-- Allocation lines pulled automatically from paid invoices remember which
-- invoice they came from, so a sync can run any number of times without
-- double-counting and shortfalls can be refunded against the right invoice.
ALTER TABLE "allocation_line" ADD COLUMN IF NOT EXISTS "source_invoice_id" uuid
  REFERENCES "invoice"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_line_source_invoice_product_uniq"
  ON "allocation_line" ("source_invoice_id", "product_id")
  WHERE "source_invoice_id" IS NOT NULL;
--> statement-breakpoint

-- Refunds owed to buyers when a supplier short-ships a paid allocation.
CREATE TABLE IF NOT EXISTS "refund_due" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoice"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
  "round_id" uuid REFERENCES "allocation_round"("id") ON DELETE SET NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
  "reason" text NOT NULL,
  -- pending (owner must pay it back) | refunded | failed (auto refund errored)
  "status" text NOT NULL DEFAULT 'pending',
  "method" text,
  "stripe_refund_id" text,
  "last_error" text,
  "resolved_by" uuid REFERENCES "user"("id"),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_due_invoice_round_uniq"
  ON "refund_due" ("invoice_id", "round_id");
--> statement-breakpoint

-- Email outbox: notification emails that failed to send are queued here
-- and retried by the daily ops sweep instead of being silently dropped.
CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "to_address" text NOT NULL,
  "subject" text NOT NULL,
  "text_body" text NOT NULL,
  "html_body" text,
  "context" text NOT NULL,
  -- pending | sent | dead
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 1,
  "last_error" text,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_pending_idx"
  ON "email_outbox" ("status", "next_attempt_at");

--> statement-breakpoint
-- Bug fix: internal-buyer provisioning created contacts with role "owner",
-- which is not a contact role and normalized to "viewer" (browse-only), so
-- the owners' own buyer login could never order.
UPDATE "account_contact" SET "role_on_account" = 'primary' WHERE "role_on_account" = 'owner';
