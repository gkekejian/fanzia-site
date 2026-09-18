-- Supplier price intelligence: price-list history, supplier unit prices
-- (append-only, supersede-never-mutate like price_epoch), per-supplier
-- shipping rules, and owner-set FX rates (append-only).
--
-- W5: migrations 0020 + 0021 are owner-only price-intel tables. 0016-0019
-- were reserved for sibling workers; see _journal.json (coordinator-owned).

DO $$ BEGIN
  CREATE TYPE "public"."shipping_rule_type" AS ENUM('flat_per_order', 'per_case', 'free_over');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_price_list" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "uploaded_by" uuid,
  "file_key" text NOT NULL,
  "original_filename" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_price" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  "currency_code" text NOT NULL,
  "moq" integer,
  "case_size" integer,
  "shipping_terms" text,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "source_list_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_shipping_rule" (
  "supplier_id" uuid PRIMARY KEY NOT NULL,
  "rule_type" "shipping_rule_type" NOT NULL,
  "amount_minor" bigint,
  "threshold_minor" bigint,
  "payment_fee_bps" integer,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fx_rate" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_currency" text NOT NULL,
  "to_currency" text NOT NULL,
  "rate" numeric(20, 8) NOT NULL,
  "set_by" uuid,
  "set_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_price_list" ADD CONSTRAINT "supplier_price_list_supplier_id_supplier_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_supplier_id_supplier_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_product_id_product_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_source_list_id_supplier_price_list_id_fk"
    FOREIGN KEY ("source_list_id") REFERENCES "public"."supplier_price_list"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_price_supplier_product_valid_idx"
  ON "supplier_price" ("supplier_id", "product_id", "valid_from" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fx_rate_pair_set_idx"
  ON "fx_rate" ("from_currency", "to_currency", "set_at" DESC);
--> statement-breakpoint
-- Append-only enforcement, mirroring migration 0006's price_epoch pattern:
-- a supplier_price is a quoted price observed at valid_from; a fx_rate is
-- the owner's assumed rate at set_at. Both are superseded by new rows,
-- never edited in place.
CREATE OR REPLACE FUNCTION supplier_price_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier_price is append-only: % is not permitted — insert a new row instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fx_rate_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fx_rate is append-only: % is not permitted — insert a new row instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS supplier_price_no_update ON supplier_price;
--> statement-breakpoint
DROP TRIGGER IF EXISTS supplier_price_no_delete ON supplier_price;
--> statement-breakpoint
DROP TRIGGER IF EXISTS fx_rate_no_update ON fx_rate;
--> statement-breakpoint
DROP TRIGGER IF EXISTS fx_rate_no_delete ON fx_rate;
--> statement-breakpoint
CREATE TRIGGER supplier_price_no_update
  BEFORE UPDATE ON supplier_price
  FOR EACH ROW EXECUTE FUNCTION supplier_price_block_mutation();
--> statement-breakpoint
CREATE TRIGGER supplier_price_no_delete
  BEFORE DELETE ON supplier_price
  FOR EACH ROW EXECUTE FUNCTION supplier_price_block_mutation();
--> statement-breakpoint
CREATE TRIGGER fx_rate_no_update
  BEFORE UPDATE ON fx_rate
  FOR EACH ROW EXECUTE FUNCTION fx_rate_block_mutation();
--> statement-breakpoint
CREATE TRIGGER fx_rate_no_delete
  BEFORE DELETE ON fx_rate
  FOR EACH ROW EXECUTE FUNCTION fx_rate_block_mutation();
