/**
 * Canonical roles for contacts on a buyer account. Stored as free text in
 * `account_contact.role_on_account` (legacy rows say "primary"); every
 * write path validates against this list, and permission checks below are
 * the single source of truth for what each role may do.
 *
 * - primary:   full control of the account — order, manage contacts, view all.
 * - purchaser: build drafts and submit order requests. Cannot manage contacts.
 * - viewer:    read-only — browse the catalog, never modify a draft.
 */
export const CONTACT_ROLES = ["primary", "purchaser", "viewer"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export function isValidContactRole(role: string): role is ContactRole {
  return (CONTACT_ROLES as readonly string[]).includes(role);
}

/** Normalize legacy/free-text values; unknown values fall back to viewer (least privilege). */
export function normalizeContactRole(role: string | null | undefined): ContactRole {
  if (role && isValidContactRole(role)) return role;
  return "viewer";
}

/** May this role create or modify draft requests (and later, submit orders)? */
export function canOrder(role: ContactRole): boolean {
  return role === "primary" || role === "purchaser";
}

/** May this role invite, change, or disable other contacts on the account? */
export function canManageContacts(role: ContactRole): boolean {
  return role === "primary";
}
