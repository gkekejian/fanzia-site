CREATE TYPE "public"."product_condition" AS ENUM('sealed', 'no_shrink');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."route_confidence" AS ENUM('estimated', 'observed', 'quoted', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."route_source_type" AS ENUM('public_faq', 'member_page', 'invoice', 'broker_entry');--> statement-breakpoint
CREATE TYPE "public"."route_type" AS ENUM('import', 'domestic');--> statement-breakpoint
CREATE TYPE "public"."source_check_confidence" AS ENUM('observed', 'quoted', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."source_check_method" AS ENUM('member_page', 'email_quote', 'phone', 'supplier_confirmation');--> statement-breakpoint
CREATE TYPE "public"."catalog_import_row_diff_type" AS ENUM('add', 'price_change', 'availability_change', 'missing', 'unchanged', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."catalog_import_status" AS ENUM('staged', 'approved', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"edition_language" text NOT NULL,
	"origin" text NOT NULL,
	"condition" "product_condition" NOT NULL,
	"packs_per_unit" integer NOT NULL,
	"cards_per_pack" integer,
	"release_status" text NOT NULL,
	"description_original" text NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"publicly_visible" boolean DEFAULT false NOT NULL,
	"image_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sourcing_route_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" uuid,
	"stock_observed" integer,
	"price_observed_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"method" "source_check_method" NOT NULL,
	"confidence" "source_check_confidence" NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"evidence_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sourcing_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"route_type" "route_type" NOT NULL,
	"confidence" "route_confidence" NOT NULL,
	"source_type" "route_source_type" NOT NULL,
	"source_reference" text,
	"target_markup_bps_override" integer,
	"markup_floor_bps_override" integer,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"invoice_due_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_epoch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sourcing_route_id" uuid,
	"cost_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"markup_bps" integer NOT NULL,
	"price_minor" bigint NOT NULL,
	"realized_gross_margin_bps" integer NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_from_import_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"file_format" text NOT NULL,
	"status" "catalog_import_status" DEFAULT 'staged' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"diff_type" "catalog_import_row_diff_type" NOT NULL,
	"staged_data" jsonb NOT NULL,
	"validation_errors" jsonb,
	"matched_product_id" uuid,
	"included" boolean DEFAULT true NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buyer_magic_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_contact_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_magic_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buyer_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_contact_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "draft_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_request_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_check" ADD CONSTRAINT "source_check_sourcing_route_id_sourcing_route_id_fk" FOREIGN KEY ("sourcing_route_id") REFERENCES "public"."sourcing_route"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_check" ADD CONSTRAINT "source_check_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_check" ADD CONSTRAINT "source_check_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sourcing_route" ADD CONSTRAINT "sourcing_route_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sourcing_route" ADD CONSTRAINT "sourcing_route_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sourcing_route" ADD CONSTRAINT "sourcing_route_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_epoch" ADD CONSTRAINT "price_epoch_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_epoch" ADD CONSTRAINT "price_epoch_sourcing_route_id_sourcing_route_id_fk" FOREIGN KEY ("sourcing_route_id") REFERENCES "public"."sourcing_route"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_epoch" ADD CONSTRAINT "price_epoch_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_epoch" ADD CONSTRAINT "price_epoch_published_from_import_id_catalog_import_id_fk" FOREIGN KEY ("published_from_import_id") REFERENCES "public"."catalog_import"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_epoch" ADD CONSTRAINT "price_epoch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_import" ADD CONSTRAINT "catalog_import_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_import" ADD CONSTRAINT "catalog_import_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_import" ADD CONSTRAINT "catalog_import_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_import_row" ADD CONSTRAINT "catalog_import_row_catalog_import_id_catalog_import_id_fk" FOREIGN KEY ("catalog_import_id") REFERENCES "public"."catalog_import"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_import_row" ADD CONSTRAINT "catalog_import_row_matched_product_id_product_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buyer_magic_link" ADD CONSTRAINT "buyer_magic_link_account_contact_id_account_contact_id_fk" FOREIGN KEY ("account_contact_id") REFERENCES "public"."account_contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buyer_session" ADD CONSTRAINT "buyer_session_account_contact_id_account_contact_id_fk" FOREIGN KEY ("account_contact_id") REFERENCES "public"."account_contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buyer_session" ADD CONSTRAINT "buyer_session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_request" ADD CONSTRAINT "draft_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
