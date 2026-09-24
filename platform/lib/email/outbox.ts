import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, lte } from "drizzle-orm";
import { emailOutbox, notification } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const OUTBOX_MAX_ATTEMPTS = 5;

type EmailParams = { to: string; subject: string; text: string; html?: string };
type Sender = (params: EmailParams) => Promise<unknown>;

async function resolveDb(db?: AnyDb): Promise<AnyDb> {
  if (db) return db;
  return (await import("@/db/client")).db as unknown as AnyDb;
}

/** Backoff after the Nth failed attempt: 1h, 4h, 9h, 16h… (daily sweep picks it up when due). */
export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + attempts * attempts * 60 * 60 * 1000);
}

/**
 * Called when a best-effort notification email fails (Resend down, bad
 * key, rate limit). Before this existed the email was logged and lost.
 * Never throws: if even the database is down there is nothing better to do
 * than the log line the caller already wrote.
 */
export async function enqueueFailedEmail(params: EmailParams, context: string, error: string, db?: AnyDb): Promise<void> {
  try {
    const handle = await resolveDb(db);
    const now = new Date();
    await handle.insert(emailOutbox).values({
      toAddress: params.to,
      subject: params.subject,
      textBody: params.text,
      htmlBody: params.html ?? null,
      context,
      attempts: 1,
      lastError: error.slice(0, 500),
      nextAttemptAt: nextAttemptAt(1, now),
    });
  } catch (err) {
    console.error("[email:outbox-enqueue-failed]", context, (err as Error).message);
  }
}

/**
 * Retry due outbox rows (run by the daily ops sweep). After
 * OUTBOX_MAX_ATTEMPTS the row is marked dead and an in-app warning is
 * written, deliberately NOT an email, since email is what's failing.
 */
export async function retryEmailOutbox(
  db: AnyDb,
  send: Sender,
  now: Date = new Date(),
): Promise<{ sent: number; retried: number; dead: number }> {
  const due = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.nextAttemptAt, now)))
    .limit(50);

  let sent = 0;
  let retried = 0;
  let dead = 0;
  for (const row of due) {
    try {
      await send({ to: row.toAddress, subject: row.subject, text: row.textBody, html: row.htmlBody ?? undefined });
      await db.update(emailOutbox).set({ status: "sent", sentAt: now }).where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = (err as Error).message.slice(0, 500);
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        await db
          .update(emailOutbox)
          .set({ status: "dead", attempts, lastError: message })
          .where(eq(emailOutbox.id, row.id));
        await db.insert(notification).values({
          type: "email_failed",
          title: `Email to ${row.toAddress} could not be delivered`,
          body: `"${row.subject}" failed ${attempts} times (last error: ${message}). Check the Resend dashboard and contact the recipient directly if it mattered.`,
          severity: "warning",
        });
        dead++;
      } else {
        await db
          .update(emailOutbox)
          .set({ attempts, lastError: message, nextAttemptAt: nextAttemptAt(attempts, now) })
          .where(eq(emailOutbox.id, row.id));
        retried++;
      }
    }
  }
  return { sent, retried, dead };
}
