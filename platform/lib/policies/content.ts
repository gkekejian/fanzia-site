/**
 * Policy content (build prompt §7, §19 Phase 0: draft Terms of Sale, Privacy,
 * Shipping, Returns, Import Edition, and AI Data-Access policies). These are
 * published as immutable, versioned `terms_version` rows (see db/seed.ts and
 * lib/bootstrap.ts) and rendered on the standalone policy pages.
 *
 * Status: OWNER-FINALIZED v1 (2026-09-22). George Kekejian confirmed the legal
 * entity as Fanzia, Inc., a Delaware corporation, and directed that these
 * documents be finalized on a best-effort basis WITHOUT attorney/compliance
 * review. They are the live documents buyers see and accept. If counsel is
 * engaged later, publish new versions through the normal version-label flow
 * (bump a doc's versionLabel and the next boot publishes a new immutable row).
 */

export const LEGAL_ENTITY_NAME = "Fanzia, Inc., a Delaware corporation";

export const DRAFT_POLICIES: Record<
  | "terms_of_sale"
  | "privacy_policy"
  | "shipping_policy"
  | "returns_policy"
  | "import_edition_acknowledgment"
  | "ai_data_policy",
  { title: string; versionLabel: string; body: string }
> = {
  terms_of_sale: {
    title: "Terms of Sale",
    versionLabel: "v1",
    body: `
# Terms of Sale

These Terms of Sale govern wholesale purchases from Fanzia (${LEGAL_ENTITY_NAME}) by
verified business buyers.

1. **Business buyers only.** Fanzia sells at wholesale only to verified businesses that have
   completed the application and approval process.
2. **No affiliation.** Fanzia is an independent wholesale sourcing and import business. Fanzia
   is not an authorized distributor and is not affiliated with, authorized by, endorsed by, or
   approved by The Pokémon Company, The Pokémon Company International, Nintendo, Creatures
   Inc., GAME FREAK inc., Konami, Bandai, or any other rights holder.
3. **A request is not a sale.** Submitting an order request does not reserve inventory or
   guarantee availability. Availability is indicative until Fanzia confirms an allocation in
   writing, and an allocation offer expires at the date and time stated on the offer.
4. **Allocations are not guaranteed.** Product allocations are offered at Fanzia's sole
   discretion. An allocation offer is never guaranteed and may be reduced, modified, or
   withdrawn before Fanzia confirms it in writing.
5. **Payment and clearance.** Fanzia orders inventory from its suppliers only after payment has
   genuinely cleared according to the hold period applicable to the buyer's chosen payment
   method, as disclosed at checkout.
6. **Pricing.** Wholesale item price, estimated or fixed outbound shipping, and applicable sales
   tax are shown separately before invoicing. Fanzia's supplier cost, sourcing routes, and
   internal markup are never disclosed to buyers.
7. **All sales final — no returns.** This is a wholesale business. All wholesale sales are
   final. Fanzia does not accept returns or exchanges for any reason, including change of
   mind. Claims for visible shipping damage, concealed damage, or incorrect or short goods
   are handled separately under the Returns & Claims Policy and are not returns.
8. **Account termination.** Fanzia may suspend or terminate a wholesale account at any time,
   for cause or without cause, at Fanzia's sole discretion. Termination does not affect
   completed sales, amounts already owed, or Fanzia's right to collect outstanding balances.
9. **Exceptions.** If Fanzia cannot fill an accepted allocation after payment, Fanzia will offer
   a refund, a buyer-approved substitute, or (only if the buyer elects it) account credit.
   Fanzia will never carry paid funds forward to a future order without the buyer's consent.
10. **Governing law.** These Terms are governed by the laws of the State of California,
    without regard to its conflict-of-laws principles.

*Version 1 — September 2026.*
`.trim(),
  },
  privacy_policy: {
    title: "Privacy Policy",
    versionLabel: "v1",
    body: `
# Privacy Policy

Effective date: the publication date of this version.

Fanzia (${LEGAL_ENTITY_NAME}) collects the business and contact information necessary to
verify wholesale buyers, process orders, and comply with tax and resale-certificate
requirements.

1. **Categories of personal information collected and shared.** Business identity, contact
   details, seller's permit and resale-certificate information, order and payment records, and
   device/log data. Shared only with the service providers necessary to operate the platform
   (payment processing, shipping, email delivery, hosting) — never sold.
2. **Your choices.** You may request a copy of, or the deletion of, personal information Fanzia
   holds about you by contacting george@fanzia.io. Fanzia aims to complete deletion requests
   within 45 days.
3. **Changes to this policy.** Material changes will be posted here with an updated effective
   date, and notified to active buyers by email.
4. **Do Not Track.** This site does not currently respond to browser Do-Not-Track signals.
5. **Third-party data collection.** No advertising or cross-site behavioral tracking is used on
   this platform. The application form uses Cloudflare Turnstile for bot verification, which
   processes limited technical data solely to distinguish humans from bots.

*This policy is written to be truthful about what is actually implemented, per FTC Act
Section 5 — no statement here promises more than the platform does.*

*Version 1 — September 2026.*
`.trim(),
  },
  shipping_policy: {
    title: "Shipping Policy",
    versionLabel: "v1",
    body: `
# Shipping Policy

1. Outbound shipping is quoted and charged separately from the wholesale item price and shown
   on the allocation offer before you accept.
2. Estimated delivery windows are estimates, not guaranteed delivery dates. If a window changes
   materially, Fanzia will notify you and explain why.
3. Small-order shipments below the posted small-order threshold may include a disclosed
   small-order fee, shown at request time — never first appearing on the invoice.
4. Carrier variance from the quoted shipping estimate at time of acceptance is Fanzia's risk,
   not the buyer's, once an offer has been accepted.

*Version 1 — September 2026.*
`.trim(),
  },
  returns_policy: {
    title: "Returns & Claims Policy",
    versionLabel: "v1",
    body: `
# Returns & Claims Policy

Fanzia distinguishes between:

- **Visible shipping damage** — reported at delivery with photos.
- **Concealed damage** — discovered after unboxing, reported within the claim window stated on
  your packing slip.
- **Incorrect or short goods** — reported with lot code, quantities, and photos.
- **Change-of-mind returns** — not accepted. All wholesale sales are final (see Terms of
  Sale §7).

Approved claims are resolved as a refund, a buyer-approved replacement, or (only if you elect
it) account credit. Fanzia will never substitute a resolution you did not choose.

*Version 1 — September 2026.*
`.trim(),
  },
  import_edition_acknowledgment: {
    title: "Import & Edition Acknowledgment",
    versionLabel: "v1",
    body: `
# Import & Edition Acknowledgment

Products sourced internationally by Fanzia may differ from a domestic release in language,
edition, packaging, and included promotional materials. By placing an order, the buyer
acknowledges:

1. The product's edition, language, and origin are disclosed on the catalog listing before
   request.
2. Fanzia is not an authorized distributor of any manufacturer and makes no claim of
   affiliation, authorization, or endorsement by any rights holder.
3. Import lead times are estimates and may be affected by customs processing outside Fanzia's
   control.

*Version 1 — September 2026.*
`.trim(),
  },
  ai_data_policy: {
    title: "AI Data-Access Policy",
    versionLabel: "v1",
    body: `
# AI Data-Access Policy

Fanzia (${LEGAL_ENTITY_NAME}) uses automated systems, including artificial intelligence,
to help operate its wholesale platform. This policy describes what those systems do with
applicant and buyer information.

1. **Where AI is used.** AI assists Fanzia staff in two places: (a) reviewing wholesale
   applications — drafting business summaries and pass/fail checklists from the information
   the applicant provides; and (b) the staff dashboard operator, which drafts suggestions,
   briefs, and routine operational text for staff. AI drafts; it does not decide.
2. **Humans decide.** Every application decision — approval, denial, or a request for more
   information — is made by a Fanzia staff member. AI output is a draft for human review,
   never a final determination. Approval-gated actions (sending messages, publishing,
   allocating inventory) always require explicit human approval.
3. **Your consent.** By submitting a wholesale application, you consent to your application
   information being processed by these automated systems, as described in the AI/automation
   disclosure on the application form.
4. **What data is processed.** The business and contact information you provide in your
   application and supporting documents. Fanzia never requests government ID numbers (EINs
   are never collected) and does not use AI for identity verification or credit decisions.
5. **Who processes the data.** Applicant information is processed by Fanzia staff and by the
   AI service provider that powers the dashboard operator, solely to provide that service.
   Fanzia does not sell applicant or buyer data and does not share it with third parties for
   their own marketing.
6. **Service providers.** Like the rest of the platform, AI-assisted processing relies only on
   the service providers necessary to operate it (hosting, email delivery, payment
   processing) — never sold, never shared beyond operating the platform.
7. **Retention and deletion.** Application records are kept as business records of the
   application decision. You may request a copy of, or the deletion of, personal information
   Fanzia holds about you by contacting george@fanzia.io. Fanzia aims to complete deletion
   requests within 45 days, subject to legal record-keeping obligations.
8. **Changes to this policy.** Material changes will be posted here with a new version and
   effective date.

*Version 1 — September 2026.*
`.trim(),
  },
};
