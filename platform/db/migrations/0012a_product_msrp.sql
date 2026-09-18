-- Manufacturer's suggested retail price per wholesale unit, in minor currency
-- units (cents for USD). NULL means unknown — MSRP is never invented; when
-- unknown the buyer UI shows "—" instead of a margin. Sourced from the
-- optional `msrp` column of a catalog import (dollar amount, parsed to
-- minor units at stage time) and written at publish.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "msrp_minor" bigint;
--> statement-breakpoint
COMMENT ON COLUMN "product"."msrp_minor" IS 'MSRP per wholesale unit in minor currency units; NULL = unknown (never invented). Buyer-facing reference for buyer margin math only — never Fanzia cost data.';
