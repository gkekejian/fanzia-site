-- Application intake hardening (owner request 2026-09-20): no more
-- half-completed submissions. Mandatory US-only entity info, resale
-- certificate number + copy at submit time, shop/location/volume details,
-- typed signature, and AI-disclosure acceptance.
--
-- New columns are nullable (not NOT NULL) so the migration applies cleanly
-- to applications submitted before these fields existed; the zod schema in
-- lib/validation/application.ts enforces them for every new submission.
-- location_count / expected_monthly_volume_usd get neutral NOT NULL
-- defaults instead.

CREATE TYPE "application_entity_type" AS ENUM(
  'sole_proprietorship',
  'llc',
  'corporation',
  'limited_partnership',
  'llp'
);

ALTER TABLE "application"
  ADD COLUMN "dba" text,
  ADD COLUMN "entity_type" "application_entity_type",
  ADD COLUMN "formation_state" text,
  ADD COLUMN "sos_entity_number" text,
  ADD COLUMN "location_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN "years_in_business" integer,
  ADD COLUMN "expected_monthly_volume_usd" integer NOT NULL DEFAULT 0,
  ADD COLUMN "resale_cert_number" text,
  ADD COLUMN "resale_cert_state" text,
  ADD COLUMN "signature_name" text,
  ADD COLUMN "ai_disclosure_accepted_at" timestamp with time zone,
  ADD COLUMN "ai_disclosure_language" text;

-- General brick-and-mortar retail was missing from the channel list
-- (only specialty channels existed). Shared enum with account — additive
-- only, existing values untouched.
ALTER TYPE "channel_type" ADD VALUE IF NOT EXISTS 'retail_store';
