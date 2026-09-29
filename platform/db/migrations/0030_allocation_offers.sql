-- Allocation model + invite codes (2026-09-29). See docs/allocation-design.md.

-- The unit a product's quantity counts ("Booster Pack", "Box", "Bundle",
-- "Case"). NULL falls back to the name heuristic in lib/member/shopping.ts.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sell_unit" text;
--> statement-breakpoint

-- Card on file. Stripe holds the card; Fanzia stores only the ids and the
-- display details (brand, last 4, expiry).
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_payment_method_id" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_brand" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_last4" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_exp_month" integer;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_exp_year" integer;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "card_updated_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_stripe_customer_uniq"
  ON "account" ("stripe_customer_id") WHERE "stripe_customer_id" IS NOT NULL;
--> statement-breakpoint

-- Invite codes: let a specific person apply while applications are closed.
-- Only the SHA-256 of the code is stored; the raw code is emailed and shown
-- to the owner once.
CREATE TABLE IF NOT EXISTS "application_invite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "code_hint" text NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "note" text,
  "source_message_id" uuid REFERENCES "contact_message"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "user"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "used_application_id" uuid REFERENCES "application"("id") ON DELETE SET NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_invite_code_hash_uniq" ON "application_invite" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_invite_email_idx" ON "application_invite" (lower("email"));
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "invite_id" uuid REFERENCES "application_invite"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Interest list: what a buyer wants, in the product's own unit.
CREATE TABLE IF NOT EXISTS "buyer_interest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "product"("id") ON DELETE CASCADE,
  "desired_qty" integer NOT NULL CHECK ("desired_qty" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_interest_account_product_uniq" ON "buyer_interest" ("account_id", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_interest_product_idx" ON "buyer_interest" ("product_id");
--> statement-breakpoint

-- A drop: one supplier release/buy offered out to buyers.
-- status: draft | live | closed | cancelled
CREATE TABLE IF NOT EXISTS "allocation_drop" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "supplier_id" uuid REFERENCES "supplier"("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "offers_close_at" timestamp with time zone,
  "lead_time_min_days" integer NOT NULL DEFAULT 10 CHECK ("lead_time_min_days" >= 0),
  "lead_time_max_days" integer NOT NULL DEFAULT 15 CHECK ("lead_time_max_days" >= "lead_time_min_days"),
  "notes" text,
  "created_by" uuid REFERENCES "user"("id"),
  "sent_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "supplier_round_id" uuid REFERENCES "allocation_round"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "allocation_drop_status_chk" CHECK ("status" IN ('draft', 'live', 'closed', 'cancelled'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "allocation_drop_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "drop_id" uuid NOT NULL REFERENCES "allocation_drop"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "product"("id"),
  "unit_price_minor" integer NOT NULL CHECK ("unit_price_minor" > 0),
  "available_qty" integer NOT NULL CHECK ("available_qty" >= 0),
  "increment" integer NOT NULL DEFAULT 1 CHECK ("increment" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_drop_item_drop_product_uniq" ON "allocation_drop_item" ("drop_id", "product_id");
--> statement-breakpoint

-- One buyer's all-or-nothing offer for one drop item.
-- status: proposed | offered | paying | accepted | reserved | declined | expired | cancelled
CREATE TABLE IF NOT EXISTS "allocation_offer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "drop_id" uuid NOT NULL REFERENCES "allocation_drop"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "allocation_drop_item"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
  "qty" integer NOT NULL CHECK ("qty" > 0),
  "unit_price_minor" integer NOT NULL CHECK ("unit_price_minor" > 0),
  "total_minor" integer NOT NULL CHECK ("total_minor" > 0),
  "status" text NOT NULL DEFAULT 'proposed',
  "wave" integer NOT NULL DEFAULT 1,
  "score" integer,
  "score_detail" jsonb,
  "expires_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "invoice_id" uuid REFERENCES "invoice"("id") ON DELETE SET NULL,
  "checkout_session_id" text,
  "checkout_expires_at" timestamp with time zone,
  "charge_started_at" timestamp with time zone,
  "last_payment_error" text,
  "decline_reason" text,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "allocation_offer_status_chk" CHECK ("status" IN ('proposed', 'offered', 'paying', 'accepted', 'reserved', 'declined', 'expired', 'cancelled'))
);
--> statement-breakpoint
-- At most one live offer per buyer per item.
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_offer_live_uniq"
  ON "allocation_offer" ("item_id", "account_id")
  WHERE "status" IN ('proposed', 'offered', 'paying');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allocation_offer_account_idx" ON "allocation_offer" ("account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allocation_offer_deadline_idx" ON "allocation_offer" ("status", "expires_at");
--> statement-breakpoint

-- The offer an invoice pays for (one invoice per offer, ever).
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "allocation_offer_id" uuid REFERENCES "allocation_offer"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_allocation_offer_uniq"
  ON "invoice" ("allocation_offer_id") WHERE "allocation_offer_id" IS NOT NULL;
--> statement-breakpoint

-- Late payment on an offer that was no longer live: at most one refund row
-- per invoice outside a supplier round (round refunds keep their own index).
CREATE UNIQUE INDEX IF NOT EXISTS "refund_due_invoice_noround_uniq"
  ON "refund_due" ("invoice_id") WHERE "round_id" IS NULL;
