-- Supplier price intelligence, part 2: market-price observations (eBay
-- sold medians and manual entries) and the explicit estimated→real
-- pricing flip flag per product. W5: migrations 0020 + 0021 are
-- owner-only; do not renumber.

DO $$ BEGIN
  CREATE TYPE "public"."market_price_source" AS ENUM('manual', 'ebay_sold');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."market_price_confidence" AS ENUM('high', 'low');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."pricing_flag_state" AS ENUM('estimated', 'real');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_price" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "market_price_minor" bigint NOT NULL,
  "source" "market_price_source" NOT NULL,
  "source_url" text,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sample_size" integer,
  "confidence" "market_price_confidence" DEFAULT 'high' NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_pricing_flag" (
  "product_id" uuid PRIMARY KEY NOT NULL,
  "is_real" "pricing_flag_state" DEFAULT 'estimated' NOT NULL,
  "set_by" uuid,
  "set_at" timestamp with time zone,
  "notes" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "market_price" ADD CONSTRAINT "market_price_product_id_product_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "product_pricing_flag" ADD CONSTRAINT "product_pricing_flag_product_id_product_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_price_product_observed_idx"
  ON "market_price" ("product_id", "observed_at" DESC);
