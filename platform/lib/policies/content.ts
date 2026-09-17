/**
 * Draft policy content (build prompt §7, §19 Phase 0: "Add draft Terms of
 * Sale, Privacy, Shipping, Returns, and Import Edition policies"). These
 * are seeded as v1 draft `terms_version` rows and rendered on the standalone
 * policy pages. They are NOT final legal documents — build prompt §7, §15,
 * and §21 require attorney/compliance review before production launch, and
 * PROJECT_SCOPE_FINAL.md §7 flags the entity-name gap explicitly.
 *
 * The bracketed legal-entity placeholder is intentional: George Kekejian
 * and Joseph Moses need to confirm the registered entity/state of
 * incorporation before an attorney can review these documents (see
 * PROJECT_SCOPE_FINAL.md §7, item 2).
 */

export const LEGAL_ENTITY_PLACEHOLDER = "[[LEGAL ENTITY — CONFIRM BEFORE ATTORNEY REVIEW]]";

export const DRAFT_POLICIES: Record<
  "terms_of_sale" | "privacy_policy" | "shipping_policy" | "returns_policy" | "import_edition_acknowledgment",
  { title: string; versionLabel: string; body: string }
> = {
  terms_of_sale: {
    title: "Terms of Sale",
    versionLabel: "draft-v1",
    body: `
# Terms of Sale (DRAFT)

These Terms of Sale govern wholesale purchases from Fanzia (${LEGAL_ENTITY_PLACEHOLDER}) by
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
4. **Payment and clearance.** Fanzia orders inventory from its suppliers only after payment has
   genuinely cleared according to the hold period applicable to the buyer's chosen payment
   method, as disclosed at checkout.
5. **Pricing.** Wholesale item price, estimated or fixed outbound shipping, and applicable sales
   tax are shown separately before invoicing. Fanzia's supplier cost, sourcing routes, and
   internal markup are never disclosed to buyers.
6. **Exceptions.** If Fanzia cannot fill an accepted allocation after payment, Fanzia will offer
   a refund, a buyer-approved substitute, or (only if the buyer elects it) account credit.
   Fanzia will never carry paid funds forward to a future order without the buyer's consent.
7. **Governing law.** [[TO BE CONFIRMED WITH COUNSEL]].

*This document is a draft pending attorney/compliance review and is not yet in force.*
`.trim(),
  },
  privacy_policy: {
    title: "Privacy Policy",
    versionLabel: "draft-v1",
    body: `
# Privacy Policy (DRAFT)

Effective date: [[SET AT PUBLISH]]

Fanzia (${LEGAL_ENTITY_PLACEHOLDER}) collects the business and contact information necessary to
verify wholesale buyers, process orders, and comply with tax and resale-certificate
requirements.

1. **Categories of personal information collected and shared.** Business identity, contact
   details, seller's permit and resale-certificate information, order and payment records, and
   device/log data. Shared only with the service providers necessary to operate the platform
   (payment processing, shipping, email delivery, hosting) — never sold.
2. **Your choices.** You may request a copy of, or the deletion of, personal information Fanzia
   holds about you by contacting [[SUPPORT EMAIL]]. Fanzia aims to complete deletion requests
   within 45 days.
3. **Changes to this policy.** Material changes will be posted here with an updated effective
   date, and notified to active buyers by email.
4. **Do Not Track.** This site does not currently respond to browser Do-Not-Track signals.
5. **Third-party data collection.** [[CONFIRM: does any embedded third party collect cross-site
   behavioral data on this platform? Default answer today is no.]]

*This document is a draft pending attorney/compliance review and is not yet in force. It is
written to be truthful about what is actually implemented, per FTC Act Section 5 — no statement
here should ever promise more than the platform does.*
`.trim(),
  },
  shipping_policy: {
    title: "Shipping Policy",
    versionLabel: "draft-v1",
    body: `
# Shipping Policy (DRAFT)

1. Outbound shipping is quoted and charged separately from the wholesale item price and shown
   on the allocation offer before you accept.
2. Estimated delivery windows are estimates, not guaranteed delivery dates. If a window changes
   materially, Fanzia will notify you and explain why.
3. Small-order shipments below the posted small-order threshold may include a disclosed
   small-order fee, shown at request time — never first appearing on the invoice.
4. Carrier variance from the quoted shipping estimate at time of acceptance is Fanzia's risk,
   not the buyer's, once an offer has been accepted.

*This document is a draft pending attorney/compliance review and is not yet in force.*
`.trim(),
  },
  returns_policy: {
    title: "Returns & Claims Policy",
    versionLabel: "draft-v1",
    body: `
# Returns & Claims Policy (DRAFT)

Fanzia distinguishes between:

- **Visible shipping damage** — reported at delivery with photos.
- **Concealed damage** — discovered after unboxing, reported within the claim window stated on
  your packing slip.
- **Incorrect or short goods** — reported with lot code, quantities, and photos.
- **Change-of-mind returns** — [[POLICY TO BE SET BY OWNERS AND COUNSEL — not yet defined]].

Approved claims are resolved as a refund, a buyer-approved replacement, or (only if you elect
it) account credit. Fanzia will never substitute a resolution you did not choose.

*This document is a draft pending attorney/compliance review and is not yet in force.*
`.trim(),
  },
  import_edition_acknowledgment: {
    title: "Import & Edition Acknowledgment",
    versionLabel: "draft-v1",
    body: `
# Import & Edition Acknowledgment (DRAFT)

Products sourced internationally by Fanzia may differ from a domestic release in language,
edition, packaging, and included promotional materials. By placing an order, the buyer
acknowledges:

1. The product's edition, language, and origin are disclosed on the catalog listing before
   request.
2. Fanzia is not an authorized distributor of any manufacturer and makes no claim of
   affiliation, authorization, or endorsement by any rights holder.
3. Import lead times are estimates and may be affected by customs processing outside Fanzia's
   control.

*This document is a draft pending attorney/compliance review and is not yet in force.*
`.trim(),
  },
};
