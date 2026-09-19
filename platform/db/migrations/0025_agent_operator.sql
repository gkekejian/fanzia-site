-- Dashboard AI operator chat (2026-09-19).
-- agent_audit_log: chat-scoped tool activity (every tool execution + every
-- approval decision, with arguments and a result summary). Separate from the
-- append-only audit_log, which keeps recording the business consequences.
-- agent_suggestion: rows written by the daily /api/cron/agent-suggestions
-- job (margin alerts, restock ideas, market briefs, ops nudges).

DO $$ BEGIN
 CREATE TYPE "public"."agent_suggestion_kind" AS ENUM('margin_alert', 'restock_idea', 'market_brief', 'ops_nudge');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE "agent_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"tool" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"approval_decision" text DEFAULT 'executed' NOT NULL,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "agent_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "agent_suggestion_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
