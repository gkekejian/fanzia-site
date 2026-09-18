-- One row per account recording that an abandoned-draft reminder was sent
-- for a specific draft version (identified by the draft's updated_at at send
-- time). A draft that is edited after a reminder gets a new updated_at and
-- becomes eligible again; the same draft version is never reminded twice.
CREATE TABLE IF NOT EXISTS "draft_reminder_log" (
  "account_id" uuid PRIMARY KEY REFERENCES "account"("id") ON DELETE CASCADE,
  "draft_updated_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
COMMENT ON TABLE "draft_reminder_log" IS 'Dedupe log for abandoned-draft reminders: one row per account, keyed to the draft version (updated_at) the reminder was sent for.';
