CREATE TABLE "cashbook_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_date" date NOT NULL,
  "direction" text NOT NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
  "category" text NOT NULL,
  "reference_type" text,
  "reference_id" text,
  "notes" text,
  "created_by" uuid REFERENCES "user" ("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "cashbook_entry_reference_unique" ON "cashbook_entry" ("reference_type", "reference_id") WHERE "reference_type" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cashbook_entry_date_idx" ON "cashbook_entry" ("entry_date" DESC);--> statement-breakpoint
