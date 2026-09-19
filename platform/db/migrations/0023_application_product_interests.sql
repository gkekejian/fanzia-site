-- Application product interests: what the applicant wants to buy (not just
-- Pokémon). Optional multi-select on the apply form, stored as a JSON string
-- array, shown on the admin review screen.
ALTER TABLE "application" ADD COLUMN "product_interests" jsonb NOT NULL DEFAULT '[]'::jsonb;
