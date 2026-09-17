/**
 * The exact sentence rendered next to the unchecked clickwrap checkbox on
 * the public application form (app/apply/page.tsx). Shared by client and
 * server so the "visible language snapshot" captured in terms_acceptance
 * is provably the same text the applicant saw, not something reconstructed
 * after the fact from whatever the terms document happens to say later.
 */
export function termsClickwrapLabel(versionLabel: string): string {
  return `I have read and agree to Fanzia's Terms of Sale (version ${versionLabel}).`;
}
