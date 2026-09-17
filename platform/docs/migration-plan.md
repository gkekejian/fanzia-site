# Migration Plan

## Tooling

- **Drizzle ORM + drizzle-kit.** Schema is authored as TypeScript in
  `platform/db/schema/*.ts`; `drizzle-kit generate` produces a numbered, checked-in SQL file
  under `platform/db/migrations/NNNN_description.sql`. Every migration is reviewed as a normal
  code diff before it is ever applied anywhere.
- Postgres only (no SQLite dev shortcut), because the build prompt's correctness requirements
  — a transaction-safe CN-inspection gate, row locking in the state machine, `gen_random_uuid()`,
  a DB-level immutability trigger on `terms_version` — depend on real Postgres semantics that a
  lighter substitute would silently paper over.
- Local/dev/CI: Dockerized Postgres (`docker-compose.yml` in `platform/`), started with
  `npm run db:up`. No cloud database is provisioned in this build.

## Ordering rules

1. Within a phase's migration set, tables are ordered so no `CREATE TABLE ... REFERENCES`
   points at a table that doesn't exist yet in an earlier migration of the same set.
2. Where two tables in different phases have a natural cyclic reference (e.g. Phase 3's
   `order_line_allocation.sourcing_route_id` pointing at a Phase 2 table, while Phase 2 tables
   never point back at Phase 3), the FK is simply added in the later phase's migration — no
   real cycle exists once phases are respected, since dependencies only point backward in time.
3. If a genuine same-phase cycle ever appears, the FK for one side is added as a separate
   `ALTER TABLE ... ADD CONSTRAINT` migration immediately after both tables exist, rather than
   forcing a deferred-constraint hack into the initial create.
4. Cross-table invariants that Postgres CHECK constraints cannot express (e.g. "a CN-sourced
   lot cannot ship until inspection is recorded") are never attempted as CHECK constraints.
   They are enforced in the service-layer state-machine function, inside the same transaction
   as the state transition, with `SELECT ... FOR UPDATE` row locking, and are covered by a
   test that tries to force the invalid transition directly.

## Phase-to-migration mapping

| Phase | Migration set | Tables |
|---|---|---|
| 1 (this session) | `0001_identity_and_audit` | `currency`, `settings`, `user`, `session`, `totp_credential`, `recovery_code`, `api_key`, `audit_log` |
| 1 (this session) | `0002_applications` | `account`, `account_user`, `application`, `application_document`, `application_status_event`, `tax_determination` |
| 1 (this session) | `0003_terms_and_agent` | `terms_version` (+ immutability trigger), `terms_acceptance`, `agent_proposal`, `compliance_task` |
| 2 (future) | `0004_catalog` | `supplier`, `sourcing_route`, `source_check`, `product`, `price_epoch`, `catalog_import`, `catalog_import_row` |
| 3 (future) | `0005_orders_batches` | `order`, `order_line`, `sourcing_batch`, `order_line_allocation`, `allocation_offer`, `invoice`, `payment_event`, `claim` |
| 4 (future) | `0006_purchasing` | `purchase_order`, `po_line`, `receipt`, `lot`, `order_line_fulfillment` |
| 5 (future) | `0007_cashbook` | `cashbook_transaction` |

Each future migration set also adds the phase-appropriate foreign keys onto earlier tables
where later phases need to reference them (e.g. `order.account_id` referencing Phase 1's
`account`).

## Review and safety process

- No migration is applied to any database the owners consider "real" without their explicit
  go-ahead. This build only ever applies migrations to the local Docker instance and to
  ephemeral CI databases.
- Every migration file is committed alongside the schema change that produced it, never
  hand-edited after generation — if a migration needs to change, a new migration is generated.
- Destructive migrations (column drops, type narrowing) require a comment block at the top of
  the SQL file stating what data loss is possible and why it's acceptable, since this project
  has zero production data today but will not always.
- Seed scripts (`platform/db/seed.ts`) refuse to run unless `NODE_ENV !== 'production'` and the
  connection string host matches an allow-listed local/dev pattern, as a backstop against ever
  seeding placeholder owner accounts or test data into a real environment.
- Before the Phase 3 cutover (first real payments), a backup/restore drill is run against a
  disposable Neon branch and documented, satisfying build-prompt test gate #22, before any real
  customer data is accepted.

## Rollback

- Drizzle-kit generates a corresponding down migration where the change is structurally
  reversible (adding a table/column, adding an index). Where it is not (a drop, a data
  backfill), the migration file's header comment documents the manual rollback procedure
  instead of relying on an auto-generated lossy down migration.
- Because there is no production data yet, Phase 1's migrations can be freely reset
  (`drizzle-kit drop` + regenerate) during this build without any real-world consequence; that
  option goes away once real applicant data exists, at which point the review process above
  becomes load-bearing rather than precautionary.
