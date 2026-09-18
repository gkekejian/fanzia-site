-- PO pack generator (design doc §5 "Distributor-order bridge"):
-- distributor-facing SKU/UPC mapping table + stored PO pack artifacts.
--
-- distributor_sku: one row per (distributor, platform product), globally
-- unique on (supplier_id, product_id). Populated at distributor
-- onboarding; the PO pack builder treats a missing mapping as a pack
-- WARNING, never as an error.
--
-- po_pack: one stored artifact per closed allocation round per supplier.
-- status flips to 'ordered' only via the explicit owner mark-ordered
-- action. NO code path ever auto-submits a PO to a distributor.
CREATE TABLE IF NOT EXISTS "distributor_sku" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_id" uuid NOT NULL REFERENCES "supplier"("id"),
  "product_id" uuid NOT NULL REFERENCES "product"("id") ON DELETE CASCADE,
  "distributor_sku" text,
  "upc" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'distributor_sku_supplier_product_uniq'
  ) THEN
    ALTER TABLE "distributor_sku"
      ADD CONSTRAINT "distributor_sku_supplier_product_uniq" UNIQUE ("supplier_id", "product_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_pack_status') THEN
    CREATE TYPE "po_pack_status" AS ENUM ('generated', 'ordered');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "po_pack" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "round_id" text NOT NULL,
  "round_ref" text NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "supplier"("id"),
  "status" "po_pack_status" NOT NULL DEFAULT 'generated',
  "payload" jsonb NOT NULL,
  "confirmation_numbers" jsonb,
  "ordered_at" timestamp with time zone,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_pack_round_idx" ON "po_pack" ("round_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_pack_supplier_idx" ON "po_pack" ("supplier_id");
--> statement-breakpoint
COMMENT ON TABLE "distributor_sku" IS 'Distributor-facing SKU/UPC per platform product. Missing rows produce pack warnings, never errors.';
--> statement-breakpoint
COMMENT ON TABLE "po_pack" IS 'Stored PO pack artifact per closed allocation round per supplier. Status becomes ordered only via explicit owner mark-ordered; nothing here ever auto-submits to a distributor.';
