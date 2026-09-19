/**
 * The application confirmation email doubles as the document request: the
 * applicant automatically gets a checklist of exactly what's missing, so
 * nobody has to follow up manually. Documents are always uploaded after
 * submission (via the continue page), so the seller's permit copy is always
 * requested; the channel-evidence item only appears when no evidence link
 * was given on the application.
 */
export function buildApplicationConfirmationEmail(input: {
  businessLegalName: string;
  channelEvidenceUrl: string | null;
  ttlHours: number;
  resumeUrl: string;
}): { subject: string; text: string } {
  const outstandingItems = [
    "A copy of your seller's permit — we can't approve your application until this is on file.",
  ];
  if (!input.channelEvidenceUrl) {
    outstandingItems.push(
      "Channel evidence — a photo of your storefront or a screenshot of your marketplace listings, so we can see how you sell.",
    );
  }
  return {
    subject: "Your Fanzia wholesale application — a few things needed",
    text:
      `Thanks for applying to Fanzia wholesale, ${input.businessLegalName}.\n\n` +
      `Before we can review your application, please upload the following on your status page:\n\n` +
      outstandingItems.map((item) => `- ${item}`).join("\n") +
      `\n\nYour status page (valid for ${input.ttlHours} hours):\n\n${input.resumeUrl}\n\n` +
      `What's next: our team reviews every application, usually within a few business days. We'll email you when a decision is made.`,
  };
}
