# Phase Plan

Adopts build prompt §19 with the Phase 0 scope adjustment described in
`PROJECT_SCOPE_FINAL.md` §1/§3. Test gate numbers below refer to build prompt §20.

## Phase 0 — Platform app hygiene and policy shell (this session)

**Scope:** the new `platform/` app only. No file outside `platform/` is touched.

Deliverables:
- Next.js 14 + TypeScript app scaffolded inside `platform/`, independent `package.json`,
  independent CI.
- Security headers (CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`) on the platform app,
  written for its own auth/API surface rather than copied verbatim from the marketing site.
- Draft policy pages: Terms of Sale, Privacy Policy, Shipping Policy, Returns Policy, Import
  Edition acknowledgment — each visibly marked `DRAFT — PENDING LEGAL REVIEW` in the rendered
  page, not just in a code comment.
- CI: secret-scanning check and a prohibited-claims scan (greps for "authorized," "official,"
  "licensed by," "MSRP," "reserved," "guaranteed," "Pokémon Company," etc. in violation of
  §1/§5/§18) run on every push.
- `.env.example` for the platform app, matching what Phase 1 code actually reads — no
  aspirational variables for unbuilt phases.

Exit criteria: `npm run build` and `npm run typecheck` succeed; CI scans pass on a clean tree;
policy pages render and are clearly marked draft.

## Phase 1 — Identity, applications, Action Center foundation (this session)

Deliverables, mapped to build prompt §19 Phase 1 and §14.1:
- Magic-link + TOTP auth for `owner` accounts (George, Joseph); API-key auth for the
  `ai_operator` account (Muse), issued once, displayed once, stored only as a hash.
- Role enforcement at the data-access layer: `owner` unrestricted except audit-log
  immutability; `ai_operator` blocked from user/role management and audit-log mutation, and
  from any action not exposed via an authenticated human UI or the `agent_proposal` queue.
- Session handling: Secure/HttpOnly/SameSite cookies for owners; independent, non-conflicting
  concurrent sessions for the `ai_operator` API key (test: neither session type can lock out
  the other).
- Resumable public application intake: email verification, hashed resume tokens (raw token
  only ever appears in the emailed URL), private R2-backed document upload with content-sniffed
  MIME validation, size/count limits, executable rejection.
- Admin review console: one screen, documents inline, approve/decline/needs-review actions not
  blocked by tax verification; a **separate** tax-determination action gated on evidence
  (§8). `needs_review` flags replace any auto-decline/auto-waitlist logic; the triage score
  only sorts the queue.
- Terms versioning: published `terms_version` rows immutable at the DB layer (trigger-enforced,
  not convention); clickwrap acceptance capturing exact visible language, version, timestamp,
  IP, user agent, page context (Berman-compliant pattern: unchecked box, adjacent language,
  underlined linked terms, submission blocked until checked).
- `agent_proposal` table and enforcement: any restricted action attempted under an
  `ai_operator`-scoped credential creates a proposal row instead of executing; a human
  `owner` decision (approve/reject) is recorded with actor and timestamp. No restricted actions
  exist to propose yet in Phase 1 (they arrive with Phase 2+ features), so this phase ships and
  tests the plumbing: attempting any mutating action outside an approved human UI path or the
  proposal queue is rejected at the API layer.
- Applicant and admin notifications via Resend, transactional stream only (no marketing stream
  exists yet — nothing to send marketing to in Phase 1).
- Append-only `audit_log` covering every state transition, every admin/owner/ai_operator
  action, with before/after payloads.

Exit criteria / test gates satisfied this phase:
- #2 (one account cannot access another's data — enforced even though there's only
  applications/documents to protect so far; returns 404, never 403).
- #4 (approval does not grant tax exemption — evidenced by two independent state fields and
  two independent admin actions).
- #5 (EIN absent from schema, UI, logs, fixtures, exports — there is no EIN column at all).
- #19 (upload tests reject spoofed MIME, oversized files, executables, unauthorized signed-URL
  requests).
- #20 (terms acceptance stores exact visible language, version, timestamp, IP, UA, page
  context; published terms cannot be altered — attempted `UPDATE` on a published
  `terms_version` row is tested to fail at the DB layer).
- #32 (an `ai_operator`-scoped API key cannot execute any restricted action directly — only
  create an `agent_proposal`; tested against every mutating endpoint that exists in Phase 1).
- Partial #21 (accessibility: keyboard/focus/labels/contrast on the application form and admin
  console — full mobile catalog/order-flow coverage waits for Phase 2/3 UI to exist).

**Owner review checkpoint here.** Phase 2 (catalog, pricing, buyer-facing DTOs) does not start
until the owners review this phase's actual working flow end to end with test data.

## Phase 2 — Catalog and pricing (not started; owner review required first)

Corrected schema for supplier routes/`source_check` with evidence and confidence levels;
markup/margin field separation (`target_markup_bps`, `markup_floor_bps`,
`realized_gross_margin_bps`); CSV/XLSX staged import with reviewable diff and publish-on-
approval only; buyer DTO boundary enforced (member price/availability never reaches
unauthenticated responses — test gate #1); public vs. member catalog split; draft-request save.

## Phase 3 — Request, batching, allocation, payment (not started)

Configurable minimums (no global minimum — test gate #7); sourcing batches with MOQ tracking
and the four-way batch-failure resolution (top up / roll once / partial fill / cancel);
`source_check`/`allocation_offer` staleness and expiry (`expires_at <= valid_until` — test gate
#31); multi-route/multi-lot allocation; Stripe invoicing with payment-rail selection before
invoice creation (test gate #17); clearance-by-rail holds and `funds_cleared_at` gating the
`paid → ordered` transition (test gates #9, #27, #28); refund/substitute/credit exception path.

## Phase 4 — Purchasing and fulfillment (not started)

Supplier-grouped PO builder with `invoice_due_hours`/business-day/JST-holiday deadline
computation in `America/Los_Angeles`, alerting at 50%/80%/2-hours-remaining; receiving, lot
codes, inspection, the transaction-safe CN-inspection gate (test gate #13); Shippo labels and
tracking webhooks; claims/RMA; supplier reliability tracking.

## Phase 5 — Cashbook and reporting (not started)

Append-only categorized cashbook with Stripe webhook auto-import, CSV bank-statement import
with duplicate detection via `external_id + source`, committed-vs-available cash view,
per-order/per-lot profitability, tax-preparer exports, monthly reconciliation screen.

## Cross-cutting, applies every phase

- No phase is reported done until its build-prompt §20 test gates pass against non-production
  test data and the owner-facing flow works end to end (build prompt §19, final paragraph).
- Every phase's report to the owners includes: what changed, migrations, tests run and
  results, screens/flows ready for review, remaining assumptions and risks, and exact env vars
  or external-account setup still needed — delivered as the closing message of that phase's
  work, not as an additional committed file.
