CREATE TYPE "public"."terms_doc_type" AS ENUM('terms_of_sale', 'privacy_policy', 'shipping_policy', 'returns_policy', 'import_edition_acknowledgment');--> statement-breakpoint
CREATE TYPE "public"."agent_proposal_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."compliance_task_kind" AS ENUM('insurance_confirmation', 'ca_filing', 'resale_doc_expiry', 'breach_response_runbook', 'legal_policy_review', 'other');--> statement-breakpoint
CREATE TYPE "public"."compliance_task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terms_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"terms_version_id" uuid NOT NULL,
	"visible_language_snapshot" text NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"page_context" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terms_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" "terms_doc_type" NOT NULL,
	"version_label" text NOT NULL,
	"body_markdown" text NOT NULL,
	"is_draft" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"proposed_action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"decision" "agent_proposal_decision" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "compliance_task_kind" NOT NULL,
	"status" "compliance_task_status" DEFAULT 'open' NOT NULL,
	"due_date" date,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_terms_version_id_terms_version_id_fk" FOREIGN KEY ("terms_version_id") REFERENCES "public"."terms_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_proposal" ADD CONSTRAINT "agent_proposal_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_proposal" ADD CONSTRAINT "agent_proposal_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
