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
  // NOTE: the Resend SDK resolves (does not throw) on API-level failures,
  // returning { data: null, error }. Ignoring that shape silently drops
  // mail while the caller reports success — always check it.
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  if (error) {
    console.error("[email:resend-error]", error.name, error.message);
    throw new Error(`Email send failed: ${error.message}`);
  }
  return { delivered: true, loggedOnly: false, id: data?.id };
}

/**
 * Best-effort notification sender for emails that accompany an action whose
 * result must NOT depend on delivery (application confirmations, decision
 * notices, owner alerts). A failed notification is logged loudly as
 * [email:notify-failed] but never throws — the caller's action already
 * succeeded, and failing the request would produce duplicate submissions,
 * retried approvals, or lost proposals.
 *
 * The magic-link request routes are the deliberate exception: there the
 * email IS the action, so they use sendTransactionalEmail and let failures
 * surface honestly as 500s.
 */
export async function sendNotificationEmail(
  params: { to: string; subject: string; text: string; html?: string },
  context: string,
): Promise<void> {
  try {
    await sendTransactionalEmail(params);
  } catch (err) {
    console.error("[email:notify-failed]", context, err instanceof Error ? err.message : String(err));
  }
}
