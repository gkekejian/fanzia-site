import { formatMoney } from "@/lib/format";

/**
 * Buyer-facing offer email bodies for the ops sweep (cron), sent on the
 * TRANSACTIONAL stream (see lib/email/send.ts). Tone matches the existing
 * offer emails (f6dc585 added the direct offer URL there): plain, honest,
 * no marketing language, and no copy that implies stock is set aside or
 * promised to the buyer (copy-hygiene rule, test-gated by
 * scripts/scan-prohibited-claims.sh).
 *
 * Every body includes the direct offer URL so the buyer lands on
 * /member/order-requests/[id], where the ExpiredOfferPrompt offers the
 * reaccept-or-cancel actions. Nothing here promises stock, pricing beyond
 * the offer terms, or a refund that doesn't exist — an expired offer never
 * took payment, so the cancel path honestly says there is nothing to refund.
 */

/** Buyer-local formatting for an expiry timestamp (PT, since buyers are West-Coast wholesale). */
export function formatExpiryPacific(when: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(when);
}

export interface FinalExpiryEmailInput {
  to: string;
  /** Offer total in minor units (subtotal + small-order fee). */
  totalMinor: number;
  /** Direct buyer-facing offer URL: {baseUrl}/member/order-requests/{id}. */
  offerUrl: string;
  /** Fresh-offer window the buyer gets on reacceptance (from commerce.offer_expiry_hours). */
  expiryHours: number;
}

/**
 * Final-expiry email: the offer's one automatic extension was already used,
 * so the buyer must act — reaccept the same terms for a fresh offer, or
 * cancel. Includes the direct offer URL and the cancel-and-refund option.
 */
export function finalExpiryEmail(input: FinalExpiryEmailInput): {
  to: string;
  subject: string;
  text: string;
} {
  const total = formatMoney(input.totalMinor);
  return {
    to: input.to,
    subject: "Your Fanzia offer expired — reaccept or cancel",
    text:
      `Your Fanzia wholesale offer of ${total} has expired. Its one automatic extension ` +
      `was already used, so it can't be extended again.\n\n` +
      `You have two options:\n` +
      `1. Review and reaccept the same terms to receive a fresh ${input.expiryHours}-hour offer.\n` +
      `2. Cancel the offer — no payment was taken for it, so there is nothing to refund.\n\n` +
      `Review and choose here: ${input.offerUrl}`,
  };
}

export interface PreExpiryNudgeEmailInput {
  to: string;
  totalMinor: number;
  offerUrl: string;
  expiresAt: Date;
  /** Silent rollovers already consumed (0 = this expiry still gets the free extension). */
  rolloversUsed: number;
  expiryHours: number;
}

/**
 * 24h pre-expiry nudge ("expires tomorrow"). Honest about what happens on
 * lapse: a first expiry gets the one automatic extension; an already-rolled
 * offer can't be extended again and needs reacceptance. Never threatens,
 * never invents scarcity.
 */
export function preExpiryNudgeEmail(input: PreExpiryNudgeEmailInput): {
  to: string;
  subject: string;
  text: string;
} {
  const total = formatMoney(input.totalMinor);
  const afterLapse =
    input.rolloversUsed === 0
      ? `If it lapses, it will be automatically extended ${input.expiryHours} hours — nothing you need to do. ` +
        `If it expires again after that, you'll be asked to review and reaccept the terms.`
      : `This offer already used its one automatic extension, so it can't be extended again. ` +
        `To keep the same terms, review and reaccept before it expires.`;
  return {
    to: input.to,
    subject: "Your Fanzia offer expires tomorrow",
    text:
      `Heads up — your Fanzia wholesale offer of ${total} expires tomorrow ` +
      `(${formatExpiryPacific(input.expiresAt)}).\n\n` +
      `${afterLapse}\n\n` +
      `Review your offer here: ${input.offerUrl}`,
  };
}
