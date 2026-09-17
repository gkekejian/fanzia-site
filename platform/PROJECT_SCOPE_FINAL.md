# Fanzia Wholesale Platform — Project Scope (Final)

Status: **Approved for Phase 0 / Phase 1 build under overnight pre-authorization.**
Owner review checkpoint: **before Phase 2 begins.**

This document supersedes the "Complete Build Specification v2.0" referenced in the build
prompt and the build prompt's own restated assumptions wherever the two disagree. It is the
single source of truth for what gets built, in what order, and why. It was produced by
inspecting the current `fanzia-site` repository and reconciling it against the build prompt
before any production code was written.

---

## 0. What was inspected

- Repository root (`/home/hatch/workspace/fanzia-site`): a Next.js 14 App Router marketing
  site — `app/`, `components/`, `content/` — with **no database, no authentication, and no
  server-side state**. Its only server logic is two API routes (`app/api/contact`,
  `app/api/forms`) that validate a submission with Zod and forward it via Resend, falling
  back to console logging if `RESEND_API_KEY` is unset. It is deployed to Vercel
  (`vercel.json`, `sfo1` region) and already has baseline security headers (CSP, HSTS,
  `X-Frame-Options`, `Permissions-Policy`) in `next.config.js`.
- `.env.example`: three variables total (`RESEND_API_KEY`, `CONTACT_TO_EMAIL`,
  `CONTACT_FROM_EMAIL`). No Postgres, Stripe, Cloudflare, or Shippo variables exist anywhere
  in the repo today.
- Git history (12 commits): all copy, branding, and hardening work on the public marketing
  site. Nothing platform-related has been started.
- The "Complete Build Specification v2.0" mentioned in the build prompt as design input is
  **not present in this repository or in this session's context**. Everything this document
  says about v2.0 comes from the build prompt's own descriptions of its flaws (invalid CHECK
  constraint, EIN collection, mislabeled markup/margin, single-route/single-lot order lines,
  double-entry ledger, a reservation model with no supplier backing). No v2.0 file was read
  directly. If a v2.0 document surfaces later, treat it as historical input only — this
  document and the build prompt it derives from control.
- `platform/` (this directory) was empty prior to this work.

## 1. Governing constraint: repository isolation

The task that authorized this build is explicit: **nothing outside `platform/` may be read,
modified, or depended on.** The existing marketing site must remain completely untouched.

This creates a direct conflict with the build prompt's own Phase 0, which asks to "remove
personal and public phone references," "fix per-page canonical metadata," and clean up
"live placeholder content" — all of which are marketing-site concerns living in `app/`,
`components/`, and `content/` at the repo root, outside `platform/`.

**Resolution:** Phase 0 in this build is scoped to the platform application only. The
marketing-site hygiene items are noted here for the owners' awareness but are explicitly
**out of scope** for this build. They belong to the existing site's own maintenance track and
should be handled there, independently, whenever the owners choose. This build will never
touch a file outside `platform/`.

Practically, this means the Fanzia Wholesale Platform is built as a **second, independent
application** living at `platform/`, with its own `package.json`, its own dependency tree,
its own CI, and its own deployment target. It shares no runtime code, build pipeline, or
Vercel project with the marketing site unless the owners later decide to merge them — a
decision this document does not make for them.

## 2. Architecture decisions (defaults, not blocking questions)

Per the build prompt's own instruction — "do not ask questions that an admin setting or a
conservative default can answer" — the following are decided here, are all reversible, and
are recorded as defaults rather than posed as questions:

| Decision | Default | Reversibility |
|---|---|---|
| Framework | Next.js 14 (App Router) + TypeScript, matching the root site's stack for shared institutional familiarity, but as an independent app | Low cost to change before real usage |
| Hosting | Vercel, as a **separate Vercel project** from the marketing site | Standard |
| Database | Postgres via Neon (serverless Postgres, matches the DPA list in §15/§17 of the build prompt) | Standard Postgres, portable |
| ORM / migrations | Drizzle ORM + drizzle-kit — SQL-first, generates reviewable migration files, supports the raw CHECK/trigger work §12 requires | Swappable; migrations are plain SQL |
| File storage | Cloudflare R2, private bucket, short-lived signed URLs | Standard S3-compatible API |
| Email | Resend, transactional and marketing streams separated by sending domain/header per CAN-SPAM (§15) | Already in use by the marketing site |
| Payments | Stripe Invoicing (SAQ A scope) — not implemented until Phase 3 | N/A yet |
| Shipping | Shippo — not implemented until Phase 4 | N/A yet |
| Auth (owners) | Magic link + TOTP, no passwords | Standard |
| Auth (`ai_operator`) | Service-account API key, hashed at rest, no TOTP | Per §14.1 |
| Local/dev database | Dockerized Postgres for local dev and CI; no cloud database is provisioned or paid for without owner approval | Reversible, zero cost |
| Environments | development (local), preview (per-PR, ephemeral DB), production (not created in this build) | Standard |
| Subdomain | `app.fanzia.io` (proposed; not yet registered or deployed) | Cheap to change before DNS is touched |

No paid service has been created, no live API key has been requested or stored, and no
deployment has occurred. All of the above are code-level and documentation-level decisions
only.

## 3. Conflicts identified and how they were resolved

1. **Existing site has no DB/auth; the platform needs both.** Resolved by treating the
   platform as a wholly separate application (§1), sharing nothing but the parent git repo.
2. **Build prompt's Phase 0 targets the marketing site; the isolation constraint forbids
   touching it.** Resolved in §1 — Phase 0 here means platform-app hygiene (policy shell,
   CI secret/claims scanning, security headers on the *new* app) rather than root-site edits.
3. **v2.0's reservation model (`source_reservation`) vs. reality.** No supplier gives Fanzia
   a hold. The schema (§8 below, and `docs/schema-diagram.md`) implements `source_check`
   exactly as specified in the build prompt §5 and omits any reservation table. Buyer-facing
   copy will never use "reserved," "held," "secured," or "guaranteed" (test gate #35).
4. **v2.0's markup/margin conflation.** All schema fields and UI copy use `*_markup_bps` for
   markup and `realized_gross_margin_bps` for margin, per §9. No field or label anywhere
   states a markup percentage as a margin.
5. **v2.0's single `route_id`/`lot_id` on order lines.** Replaced with
   `order_line_allocation` and `order_line_fulfillment` junction tables (§12, schema diagram)
   so one line can be split across routes, POs, and lots.
6. **v2.0's CN-inspection CHECK-constraint-with-subquery.** Not implemented as a CHECK
   constraint (Postgres does not support cross-table subqueries there). Enforced instead in
   the service-layer state machine inside a transaction, with row locking, and covered by a
   test that attempts to bypass it (test gate #13).
7. **v2.0's EIN collection.** Removed entirely from the schema, forms, admin UI, exports,
   logs, and seed data (§8). No table in the amended schema has an EIN column.
8. **v2.0's double-entry general ledger.** Replaced with the append-only cashbook of §16.
   Ledger-style COGS-at-payment accounting is explicitly not built in the MVP.
9. **Global customer minimum.** No such constant or column exists anywhere in the schema or
   settings. Minimums are admin-configurable at the settings, product, and route level only
   (§3 of the build prompt).
10. **AI agent controls as "instruction" vs "capability."** Implemented as scope-limited
    credentials and an `agent_proposal` approval queue (§14, §14.1), never as a behavioral
    rule a model is asked to follow. This build prompt itself flags, and this document
    reiterates, that the separate "AI Agent Data Access Policy" document should be updated to
    describe capability enforcement rather than instructed restraint — as written today it
    describes a commitment the platform could not have enforced, which is itself an FTC
    Section 5 exposure if published externally. **Action item for owners:** revise or
    internally annotate that policy document; this build does not have access to it to edit
    directly.

## 4. Amended schema

See `docs/schema-diagram.md` for the full entity-relationship diagram (Mermaid) and table
inventory. Highlights of what changed relative to v2.0's described design:

- `source_check` replaces `source_reservation` (§5 of build prompt).
- `order_line_allocation` and `order_line_fulfillment` replace single FK columns on order
  lines, enabling multi-route/multi-PO/multi-lot fulfillment (§12).
- `agent_proposal` is new: every restricted action an AI agent identity wants to take is a row
  here, never a direct write (§14).
- `cashbook_transaction` replaces the double-entry ledger (§16): a flat, immutable,
  append-only, categorized money-event log.
- `tax_status` lives on the account (`pending | exempt | taxable`), decoupled from
  application approval (§8).
- Every money column is `(amount_minor bigint, currency_code, exponent)`, reading exponent
  from a `currency` reference table — no column anywhere assumes exponent 2 (§12, JPY safety).
- No `ein` column exists on any table.
- `terms_version` rows are immutable at the database layer — enforced via a `BEFORE UPDATE`
  rule/trigger that raises, not by application convention.
- `agent_proposal`, `audit_log`, and `compliance_task` are introduced in Phase 1 because
  identity, audit, and the Action Center depend on them from day one, even before commerce
  tables exist in Phase 2+.

## 5. Migration plan

See `docs/migration-plan.md` for full detail. Summary:

- Drizzle ORM + drizzle-kit. Every schema change is a checked-in, numbered SQL migration file
  under `platform/db/migrations/`, generated from `platform/db/schema/*.ts` and reviewed like
  any other diff before being applied to any real database.
- Migrations are grouped and delivered **per build phase**, not all at once: Phase 1 ships
  identity/audit/application/terms/agent-proposal tables; Phase 2 adds catalog/pricing;
  Phase 3 adds orders/batches/allocation/payment; Phase 4 adds purchasing/fulfillment; Phase 5
  adds the cashbook.
- Tables are created in dependency order within each phase's migration set so no forward
  reference to a not-yet-existing table is required; where a genuine cycle exists (e.g.
  `order_line_allocation` referencing both `order_line` and a Phase-2 `sourcing_route`), the
  foreign key is added in a later, additive migration rather than forcing a circular create.
- No migration is ever applied against a production database in this engagement without
  explicit owner approval — this build only runs migrations against local/dev and CI
  databases.
- No seed data contains real customer data, real credentials, or real EINs/permits beyond the
  two already-in-hand California seller's permits (Glendale, Lakewood), which are configuration
  facts, not secrets, and are stored as settings values, not documents.
- Every migration is reversible (a paired `down` is generated by drizzle-kit for schema
  changes that support it; destructive changes get a documented manual rollback note instead
  of a lossy auto-generated down migration).
- A backup/restore runbook and drill (test gate #22) is scheduled for before the Phase 3
  production cutover, once a real database exists to back up.

## 6. Phase plan

The build prompt's §19 phase plan is adopted with one adjustment: **Phase 0's scope is the
platform app, not the marketing site** (§1, §3 above). See `docs/phase-plan.md` for the full
per-phase breakdown, entry/exit criteria, and the specific test gates from §20 each phase must
satisfy before being called done.

Overnight authorization covers **Phase 0 and Phase 1 only.** Phase 2 does not begin until the
owners review Phase 1's deliverable.

## 7. Blocking owner decisions

Every other threshold, cadence, fee, and hold period in the build prompt already has a
conservative pilot default specified in §3–§17 and is implemented as an editable `settings`
row, not a hard question. The list below is deliberately short: these are facts only the
owners hold, not judgment calls a default can stand in for.

1. **Joseph Moses's email address.** Needed to seed his `owner` account per §14.1. George
   Kekejian's is known (`george@fanzia.io`, per this session's context) and Muse's
   `ai_operator` identity authenticates by API key, not email. Until provided, Phase 1 seeds
   Joseph's account with a placeholder email clearly marked `CHANGE-BEFORE-USE` and the seed
   script refuses to run against anything but a local/dev database.
2. **Registered legal entity details for policy documents.** The build prompt names "Fanzia,
   Inc." Terms of Sale, Privacy Policy, etc. need the entity's state of incorporation (or
   confirmation it is not yet incorporated as "Inc." and operates as a sole proprietorship/
   LLC) for legal accuracy. Draft policies in Phase 0 use "Fanzia" and mark the entity line
   `[[LEGAL ENTITY — CONFIRM BEFORE ATTORNEY REVIEW]]` rather than guessing.
3. **Insurance confirmation (§15 launch gate).** Not a build blocker for Phase 0/1, but
   flagged now because it gates Phase 3 (accepting customer payment against a consolidated
   batch). The owners should begin this conversation with their carrier in parallel with the
   build, since insurer response time is typically the longest lead item in the whole plan.
4. **Attorney/compliance review engagement for policy documents (§7, §15, test gate #23).**
   Same reasoning as #3 — not a Phase 0/1 blocker, but the longest lead item standing between
   Phase 1 completion and a real production launch. Starting that engagement now, in parallel,
   avoids it becoming the critical path later.

Everything else — cutoff cadences, hold periods, fee amounts, markup percentages, staleness
windows, grace periods, retention days — is a pilot default in code, changeable by an owner in
the admin settings screen without a deploy, per the build prompt's own instruction to prefer
defaults over questions.

## 8. What Phase 0/1 will NOT include

To keep the overnight scope honest:

- No real Neon, Cloudflare, Stripe, Resend (beyond what the root site already has), or Shippo
  account is created. Local dev uses Dockerized Postgres and a local filesystem stand-in for
  R2 in tests.
- No production deployment. No DNS change. No live email sends to real applicants.
- No payments code (Phase 3+). No catalog/pricing code (Phase 2+).
- Policy pages (Terms of Sale, Privacy, Shipping, Returns, Import Edition acknowledgment) are
  built as reviewable drafts, visibly marked `DRAFT — PENDING LEGAL REVIEW`, not final legal
  documents (§7, §15, §21).
- The `agent_proposal` and `ai_operator` scaffolding is built (§14/§14.1) because identity and
  audit are Phase 1 deliverables, but there are no restricted actions to propose yet — Phase 1
  ships the plumbing (roles, scopes, proposal queue, audit log) that Phase 2+ features will
  plug into as they're built.

## 9. Definition of done for this overnight session

1. This document, `docs/schema-diagram.md`, `docs/migration-plan.md`, and `docs/phase-plan.md`
   committed.
2. Phase 0 complete: platform app scaffolded, CI with secret scan + prohibited-claims scan,
   security headers, draft policy pages.
3. Phase 1 complete per `docs/phase-plan.md` exit criteria: auth (magic link + TOTP for
   owners, API key for `ai_operator`), account scoping enforced at the data-access layer,
   audit log, resumable application intake with private uploads, admin review console with
   approval/tax-verification separated, terms versioning with clickwrap evidence capture,
   `agent_proposal` table and read-only agent scope enforcement, notification emails.
4. All Phase 0/1-relevant test gates from build prompt §20 passing against local/dev data.
5. A written summary (in the final message to the owners, not a new file) covering: what was
   built, migrations, tests run and results, screens ready for review, remaining assumptions
   and risks, and the exact environment variables / external accounts still needed before
   Phase 2.
