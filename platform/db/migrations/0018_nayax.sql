-- Nayax vending connector (migration 0018): machines, planogram, sales,
-- restock params/baselines, suggestion runs, and the internal restock draft.
-- Hand-written, matching the established pattern: IF NOT EXISTS on tables/indexes,
-- plain CREATE TYPE for enums (as in 0000/0001/0005 — types are created once)
-- (0012a/0012b/0012c, 0014, 0015). Follows fanzia-as-client-design-2026-09-18
-- §3.2. Does NOT touch buyer/account or order_request tables — the internal
-- buyer and allocation rounds belong to sibling workstreams; the weekly
-- draft they consume is handed off via internal_restock_draft.
--> statement-breakpoint
CREATE TYPE "nayax_machine_location" AS ENUM ('glendale', 'lakewood');
--> statement-breakpoint
CREATE TYPE "nayax_sale_source" AS ENUM ('api', 'csv');
--> statement-breakpoint
CREATE TYPE "internal_restock_draft_status" AS ENUM ('draft', 'approved', 'joined', 'superseded');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nayax_machine" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nayax_machine_id" bigint NOT NULL,
  "name" text NOT NULL,
  "location" "nayax_machine_location" NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "nayax_machine_nayax_machine_id_unique" UNIQUE("nayax_machine_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slot_map" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL REFERENCES "nayax_machine"("id") ON DELETE cascade,
  "slot_position" integer NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "product"("id"),
  "capacity_units" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slot_map_machine_slot_unique" UNIQUE("machine_id","slot_position")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nayax_sale" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL REFERENCES "nayax_machine"("id") ON DELETE cascade,
  "slot_position" integer,
  "product_id" uuid REFERENCES "product"("id"),
  "units" integer NOT NULL,
  "amount_cents" bigint,
  "sold_at" timestamp with time zone NOT NULL,
  "nayax_txn_id" text NOT NULL,
  "source" "nayax_sale_source" NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "nayax_sale_nayax_txn_id_unique" UNIQUE("nayax_txn_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nayax_sale_machine_sold_idx" ON "nayax_sale" ("machine_id","sold_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nayax_sale_product_sold_idx" ON "nayax_sale" ("product_id","sold_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restock_params" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "product"("id"),
  "lead_time_days" integer NOT NULL,
  "safety_stock_days" integer NOT NULL,
  "review_period_days" integer NOT NULL,
  "min_order_units" integer NOT NULL,
  "preferred_case_sku" text,
  "case_units" integer NOT NULL,
  "trial_qty" integer,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restock_params_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nayax_restock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL REFERENCES "nayax_machine"("id") ON DELETE cascade,
  "slot_position" integer NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "product"("id"),
  "units_restored" integer NOT NULL,
  "restocked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nayax_restock_machine_slot_idx" ON "nayax_restock" ("machine_id","slot_position","restocked_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nayax_suggestion_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_key" text NOT NULL,
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lines" jsonb DEFAULT '[]' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "nayax_suggestion_run_week_key_unique" UNIQUE("week_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_restock_draft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_key" text NOT NULL,
  "source" text DEFAULT 'internal-suggestion' NOT NULL,
  "status" "internal_restock_draft_status" DEFAULT 'draft' NOT NULL,
  "buyer_account_id" uuid REFERENCES "account"("id"),
  "lines" jsonb DEFAULT '[]' NOT NULL,
  "estimated_cost_minor" bigint,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_restock_draft_week_key_unique" UNIQUE("week_key")
);
--> statement-breakpoint
-- Weekly suggestion cadence: which weekday (America/Los_Angeles) the
-- ops-sweep runs the suggestion engine and (re)builds the internal draft.
-- Monday aligns with a Monday distributor-ordering rhythm; the owner can
-- change it from the admin UI without a deploy.
INSERT INTO "settings" ("key", "value", "description")
VALUES ('suggestion_day', '"monday"', 'Weekday (America/Los_Angeles) the weekly vending restock suggestion runs inside the daily ops sweep.')
ON CONFLICT ("key") DO NOTHING;
