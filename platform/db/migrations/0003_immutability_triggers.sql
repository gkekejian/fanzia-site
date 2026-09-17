-- Enforces build prompt §12/§14.1 at the database layer, not by
-- application convention: nobody, including the owner role, can update or
-- delete audit_log rows; nobody can update or delete a terms_version row
-- once it has been published. These triggers are the actual enforcement —
-- application code choosing not to expose an UPDATE/DELETE path is a UX
-- decision, not the safety boundary.

CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION terms_version_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'terms_version %: cannot delete a published terms version', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'terms_version %: published terms are immutable — insert a new version instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER terms_version_no_mutate_update
  BEFORE UPDATE ON terms_version
  FOR EACH ROW EXECUTE FUNCTION terms_version_block_mutation();
--> statement-breakpoint
CREATE TRIGGER terms_version_no_mutate_delete
  BEFORE DELETE ON terms_version
  FOR EACH ROW EXECUTE FUNCTION terms_version_block_mutation();
