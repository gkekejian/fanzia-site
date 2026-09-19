/**
 * The application confirmation email doubles as the document request: the
 * applicant automatically gets told exactly what's needed, so nobody has
 * to follow up manually. The seller's permit copy is always required
 * (documents are uploaded after submission, via the continue page); the
 * channel ask is optional — brick-and-mortar style buyers (smoke shops,
 * convenience stores) don't need a channel, but if they sell online we
 * want to know where (owner direction 2026-09-19).
 */
export function buildApplicationConfirmationEmail(input: {
  businessLegalName: string;
  channelEvidenceUrl: string | null;
  onlinePresence: string | null;
  ttlHours: number;
  resumeUrl: string;
}): { subject: string; text: string } {
  const onlineAsk = input.channelEvidenceUrl || input.onlinePresence
    ? ""
    : `\nIf you sell online (Whatnot, TikTok, eBay, etc.), we'd also like to know — reply to this email with your links or upload a screenshot on your status page.\n`;
  return {
    subject: "Your Fanzia wholesale application — a few things needed",
    text:
      `Thanks for applying to Fanzia wholesale, ${input.businessLegalName}.\n\n` +
      `To complete your application, please upload a copy of your seller's permit on your status page — we can't approve your application until it's on file.` +
      onlineAsk +
      `\nYour status page (valid for ${input.ttlHours} hours):\n\n${input.resumeUrl}\n\n` +
      `What's next: our team reviews every application, usually within a few business days. We'll email you when a decision is made.`,
  };
}
