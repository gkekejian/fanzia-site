import { Resend } from "resend";

const FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@fanzia.io";

/**
 * Transactional-only sender for Phase 1 (applicant/admin notifications,
 * magic links). Falls back to console logging when RESEND_API_KEY is
 * unset — same pattern the existing marketing site uses for its contact
 * form, so local dev and CI never require a real Resend account.
 *
 * CAN-SPAM (build prompt §15) requires transactional and marketing streams
 * to stay separated by list and header. There is no marketing stream in
 * this build yet; when one exists it must use a distinct sending
 * configuration, never this function.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email:dev-fallback]", JSON.stringify(params, null, 2));
    return { delivered: false, loggedOnly: true };
  }
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return { delivered: true, loggedOnly: false };
}
