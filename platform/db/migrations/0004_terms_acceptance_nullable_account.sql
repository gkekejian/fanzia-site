ALTER TABLE "terms_acceptance" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "terms_acceptance" ADD COLUMN "application_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
