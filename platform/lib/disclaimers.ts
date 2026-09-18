/**
 * Shared customer-facing disclaimer texts. All drafts are pending attorney
 * review before production launch — see /tmp/disclaimers-audit.md.
 *
 * Conventions: "Fanzia, Inc., a Delaware corporation"; no em dashes per
 * house style; never describe inventory as reserved, held, secured, or
 * guaranteed (the prohibited-claims CI scan enforces this).
 */

/** Site-wide footer notice: entity line, wholesale-only scope, affiliation disclaimer. */
export const SITE_FOOTER_NOTE =
  "Fanzia, Inc., a Delaware corporation, sells at wholesale only to verified business buyers. " +
  "Fanzia is an independent sourcing and import business. It is not an authorized distributor of, and is not " +
  "affiliated with, authorized by, or endorsed by, any trading card rights holder.";

/**
 * Concise commercial disclosure for the member catalog page: minimums, caps,
 * fees, offer expiry, tax treatment, and price-change risk in one banner.
 */
export const COMMERCIAL_DISCLOSURE_SHORT =
  "Ordering minimums: the minimum order is $500. First orders are limited to $5,000. " +
  "Orders under $750 carry a $25 small-order fee, shown before you submit. " +
  "Outbound shipping and applicable sales tax are calculated separately and are not included in listed prices. " +
  "Catalog prices and availability are indicative and may change until Fanzia confirms your allocation in writing. " +
  "A request does not reserve inventory. Allocation offers expire 48 hours after issue. " +
  "Your account is treated as taxable until Fanzia reviews your resale documentation.";

/**
 * Invoice payment terms: fee/tax composition, cleared-funds rule per rail,
 * and no-inventory-reservation language.
 */
export const INVOICE_PAYMENT_TERMS =
  "Payment terms. The invoice total includes item price, the $25 small-order fee (orders under $750), " +
  "estimated outbound shipping, and applicable sales tax. Payment is due on receipt unless otherwise stated in writing. " +
  "The payment date and the funds-cleared date are recorded separately. Fanzia places supplier orders only after " +
  "funds clear: card payments on successful payment; ACH payments 5 business days after receipt for your first 3 " +
  "orders and 2 business days after receipt thereafter; wire payments on manual bank confirmation. " +
  "A declined or reversed payment voids the allocation. Paying does not reserve inventory that cannot be filled: " +
  "if Fanzia cannot fill an accepted allocation after payment, you may choose a full refund, a buyer-approved " +
  "substitute, or account credit. Paid funds are never carried to a future order without your consent.";

/** Order-time clickwrap acknowledgment for orders containing import product. */
export const IMPORT_CLICKWRAP_TEXT =
  "I acknowledge this order includes imported product that may differ from any domestic release in language, " +
  "edition, packaging, or promotional materials, as listed, and that import lead times are estimates subject to " +
  "customs processing.";

/** Plain-text footer appended to transactional emails. */
export const EMAIL_FOOTER =
  "Fanzia, Inc., a Delaware corporation. Wholesale only, for approved business accounts. " +
  "Fanzia is not affiliated with any trading card rights holder. This is an automated message; replies are not monitored.";
