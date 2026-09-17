-- Enforces Phase 2 append-only invariants at the database layer, not by
-- application convention, mirroring migration 0003's terms_version/audit_log
-- triggers: a price_epoch is a pricing-history entry (build prompt §11:
-- "preserve prior values and write an audit trail") and a source_check is
-- evidence of what was observed at a point in time (build prompt §5) —
-- neither is ever mutated after insert, only superseded by a new row.

CREATE OR REPLACE FUNCTION price_epoch_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'price_epoch is append-only: % is not permitted — insert a new epoch instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_epoch_no_update
  BEFORE UPDATE ON price_epoch
  FOR EACH ROW EXECUTE FUNCTION price_epoch_block_mutation();
--> statement-breakpoint
CREATE TRIGGER price_epoch_no_delete
  BEFORE DELETE ON price_epoch
  FOR EACH ROW EXECUTE FUNCTION price_epoch_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION source_check_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source_check is append-only: % is not permitted — insert a new check instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER source_check_no_update
  BEFORE UPDATE ON source_check
  FOR EACH ROW EXECUTE FUNCTION source_check_block_mutation();
--> statement-breakpoint
CREATE TRIGGER source_check_no_delete
  BEFORE DELETE ON source_check
  FOR EACH ROW EXECUTE FUNCTION source_check_block_mutation();
