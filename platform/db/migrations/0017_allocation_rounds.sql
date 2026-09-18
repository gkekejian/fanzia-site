-- Allocation rounds (batch stock splits across internal + external buyers).
-- allocation_round: a distributor order window with an immutable fairness
--   policy snapshot chosen at creation (mode 'fanzia_first': the internal
--   Fanzia buyer account is filled first per product, externals split the
--   remainder pro-rata with largest-remainder distribution, case-size
--   snapping after — see lib/allocation/engine.ts).
-- allocation_line: one buyer's requested/allocated quantity of one product
--   in a round; allocated_qty is written only by the allocate endpoint.
-- Hand-written in the 0012a/0014/0015 pattern (idempotent guards, no
-- drizzle-kit diff). Enums are created in idempotent DO blocks because the
-- IF NOT EXISTS form of CREATE TYPE is not portable here.

DO $$
BEGIN
  CREATE TYPE "public"."allocation_round_status" AS ENUM('collecting', 'allocating', 'closed', 'ordered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."allocation_line_status" AS ENUM('requested', 'allocated', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_round" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "supplier"("id"),
  "internal_account_id" uuid REFERENCES "account"("id"),
  "status" "allocation_round_status" NOT NULL DEFAULT 'collecting',
  "cutoff_at" timestamp with time zone,
  "policy_snapshot" jsonb NOT NULL,
  "created_by" uuid REFERENCES "user"("id"),
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "round_id" uuid NOT NULL REFERENCES "allocation_round"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "product"("id"),
  "requested_qty" integer NOT NULL DEFAULT 0,
  "allocated_qty" integer NOT NULL DEFAULT 0,
  "status" "allocation_line_status" NOT NULL DEFAULT 'requested',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allocation_line_round_idx" ON "allocation_line" ("round_id");
--> statement-breakpoint
COMMENT ON TABLE "allocation_round" IS 'Batch allocation round: collects buyer requests against a distributor order window and splits available stock under the immutable policy snapshot. Lifecycle: collecting → allocating → closed → ordered.';
--> statement-breakpoint
COMMENT ON COLUMN "allocation_round"."policy_snapshot" IS 'Immutable fairness policy chosen at round creation from the fixed policy dropdown. Never edited after creation; changing the default requires an owner action + audit entry.';
--> statement-breakpoint
COMMENT ON COLUMN "allocation_round"."internal_account_id" IS 'The internal Fanzia buyer account. Filled first per product under fanzia_first; NULL means no internal participant this round.';
