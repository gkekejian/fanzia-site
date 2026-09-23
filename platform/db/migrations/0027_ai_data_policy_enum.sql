-- AI Data-Access Policy doc type (owner-finalized 2026-09-22, no attorney
-- review per owner's direction). Adds 'ai_data_policy' to the terms_doc_type
-- enum so bootstrapTerms can publish the versioned AI policy row.
--
-- Safe inside the migrator's transaction: PostgreSQL 12+ permits
-- ALTER TYPE ... ADD VALUE in a transaction block (verified on PG 16.4,
-- which is what Neon runs). The value is only added here, never used in
-- this transaction, so there is no same-transaction visibility issue.
ALTER TYPE terms_doc_type ADD VALUE IF NOT EXISTS 'ai_data_policy';
