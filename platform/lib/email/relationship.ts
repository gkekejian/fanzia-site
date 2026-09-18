import { Resend } from "resend";
import { EMAIL_FOOTER } from "@/lib/disclaimers";

const FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@fanzia.io";
const UNSUBSCRIBE_MAILTO =
  process.env.RELATIONSHIP_UNSUBSCRIBE_MAILTO ?? "mailto:unsubscribe@fanzia.io?subject=Unsubscribe%20draft%20reminders";

/**
 * Relationship (non-transactional) sender: abandoned-draft reminders and
 * similar buyer-relationship mail. CAN-SPAM (build prompt §15) requires
 * transactional and marketing/relationship streams to stay separated by
 * list and header — this function MUST NOT call sendTransactionalEmail,
 * and sendTransactionalEmail must never be used for relationship mail.
 *
 * Every message carries:
 * - a List-Unsubscribe header (mailto) — the one-click stop mechanism,
 * - a plain-language stop note in the body,
 * - the same entity/wholesale footer as transactional mail.
 *
 * Falls back to console logging when RESEND_API_KEY is unset, same as the
 * transactional sender, so local dev and CI never need a real Resend
 * account. Throws on Resend API failures so the caller can decide whether
 * to retry (the abandoned-draft cron treats a throw as "not reminded" and
 * retries on the next run).
 */
export async function sendRelationshipEmail(params: {
  to: string;
  subject: string;
  text: string;
  listName: string;
}) {
  const unsubscribeAddress = UNSUBSCRIBE_MAILTO.replace(/^mailto:/, "").split("?")[0];
  const stopNote = `\n\n---\nRather not get these? Just reply STOP to this email or write to ${unsubscribeAddress} and we'll turn them off — no questions asked.`;
  const textWithFooter = `${params.text}${stopNote}\n\n---\n${EMAIL_FOOTER}\nList: ${params.listName}`;

  if (!process.env.RESEND_API_KEY) {
    console.log("[email:relationship-dev-fallback]", JSON.stringify({ ...params, text: textWithFooter }, null, 2));
    return { delivered: false, loggedOnly: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: params.subject,
    text: textWithFooter,
    headers: {
      "List-Unsubscribe": `<${UNSUBSCRIBE_MAILTO}>`,
    },
  });
  if (error) {
    console.error("[email:relationship-resend-error]", error.name, error.message);
    throw new Error(`Relationship email send failed: ${error.message}`);
  }
  return { delivered: true, loggedOnly: false, id: data?.id };
}

/**
 * Abandoned-draft reminder body. Plain and honest: what is in the draft,
 * what it costs, what the buyer stands to make, and a link back. No
 * countdown timers, no fake scarcity, no "your items are almost gone".
 */
export function draftReminderBody(params: {
  contactName: string;
  units: number;
  products: number;
  subtotalMinor: number;
  marginTotalMinor: number | null;
  resumeUrl: string;
  formatMoney: (minor: number) => string;
}): string {
  const { contactName, units, products, subtotalMinor, marginTotalMinor, resumeUrl, formatMoney } = params;
  const lines = [
    `Hi ${contactName},`,
    ``,
    `You left a draft order request on Fanzia with ${units} unit${units === 1 ? "" : "s"} across ${products} product${products === 1 ? "" : "s"} — subtotal ${formatMoney(subtotalMinor)}.`,
  ];
  if (marginTotalMinor !== null) {
    lines.push(
      `At manufacturer MSRP, the items in your draft represent about ${formatMoney(marginTotalMinor)} of potential retail margin.`,
    );
  }
  lines.push(
    ``,
    `Nothing is reserved and nothing has been charged — this is just a nudge in case you meant to finish it.`,
    ``,
    `Pick up where you left off: ${resumeUrl}`,
    ``,
    `— Fanzia`,
  );
  return lines.join("\n");
}
