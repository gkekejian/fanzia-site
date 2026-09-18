import { desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db as defaultDb } from "@/db/client";
import { contactMessage, contactMessageReply } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { sendTransactionalEmail } from "@/lib/email/send";
import type { Actor } from "@/lib/auth/rbac";

/**
 * Website inbox: visitors submit the contact form on the marketing site,
 * the team reads and replies from /admin/inbox. Replies are delivered to
 * the visitor by email; the stored copy is the record of what was sent.
 *
 * The db handle is injectable (default: the real one) purely so unit tests
 * can point this at an in-process test database — production call sites
 * never pass one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const ingestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  subject: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(40).optional().default("website"),
});

export type IngestInput = z.input<typeof ingestSchema>;

const VALID_STATUSES = new Set(["new", "open", "replied", "closed"]);

export class IngestAuthError extends Error {}
export class NotFoundError extends Error {}
export class InvalidStatusError extends Error {}

function checkIngestSecret(provided: string | null) {
  const expected = process.env.CONTACT_INGEST_SECRET;
  if (!expected) throw new IngestAuthError("Contact inbox is not configured.");
  if (!provided || provided !== expected) throw new IngestAuthError("Invalid ingest credentials.");
}

/** Public entry point: called server-side by the marketing site. */
export async function ingestContactMessage(
  input: IngestInput,
  providedSecret: string | null,
  db: AnyDb = defaultDb,
) {
  checkIngestSecret(providedSecret);
  const parsed = ingestSchema.parse(input);
  const [row] = await db
    .insert(contactMessage)
    .values({
      name: parsed.name,
      email: parsed.email,
      subject: parsed.subject || null,
      message: parsed.message,
      source: parsed.source || "website",
      status: "new",
    })
    .returning({ id: contactMessage.id });
  await recordAudit(
    {
      actorType: "system",
      action: "contact_message.received",
      entityType: "contact_message",
      entityId: row!.id,
      after: { source: parsed.source || "website", email: parsed.email },
    },
    db,
  );
  return row!;
}

export async function listContactMessages(status?: string, db: AnyDb = defaultDb) {
  if (status && !VALID_STATUSES.has(status)) throw new InvalidStatusError(`Unknown status "${status}".`);
  const rows = status
    ? await db.select().from(contactMessage).where(eq(contactMessage.status, status)).orderBy(desc(contactMessage.createdAt))
    : await db.select().from(contactMessage).orderBy(desc(contactMessage.createdAt));
  return rows;
}

export async function getContactThread(id: string, db: AnyDb = defaultDb) {
  const [message] = await db.select().from(contactMessage).where(eq(contactMessage.id, id));
  if (!message) throw new NotFoundError("Message not found.");
  const replies = await db
    .select()
    .from(contactMessageReply)
    .where(eq(contactMessageReply.messageId, id))
    .orderBy(contactMessageReply.createdAt);
  return { message, replies };
}

export async function setContactMessageStatus(id: string, status: string, actor: Actor, db: AnyDb = defaultDb) {
  if (!VALID_STATUSES.has(status)) throw new InvalidStatusError(`Unknown status "${status}".`);
  const [before] = await db.select().from(contactMessage).where(eq(contactMessage.id, id));
  if (!before) throw new NotFoundError("Message not found.");
  const [after] = await db
    .update(contactMessage)
    .set({ status })
    .where(eq(contactMessage.id, id))
    .returning();
  await recordAudit(
    {
      actorUserId: actor.kind === "owner" ? actor.user.id : null,
      actorRole: actor.kind === "owner" ? actor.user.role : "ai_operator",
      actorType: actor.kind === "owner" ? "owner" : "ai_operator",
      action: "contact_message.status_changed",
      entityType: "contact_message",
      entityId: id,
      before: { status: before.status },
      after: { status: after!.status },
    },
    db,
  );
  return after!;
}

const replySchema = z.object({ body: z.string().trim().min(1).max(10000) });

/**
 * Store a staff reply and email it to the visitor. The DB write is the
 * source of truth; a failed email send is logged loudly but does not roll
 * back the stored reply (same best-effort pattern as other notifications).
 * Marks the thread "replied".
 *
 * Returns the stored reply row plus `emailSent`, so callers can report
 * honest delivery state instead of claiming "sent" when the email only
 * got logged. (Spread preserves the row's fields for existing consumers —
 * e.g. tests reading reply.id.)
 */
export async function replyToContactMessage(id: string, rawBody: unknown, actor: Actor, db: AnyDb = defaultDb) {
  const { body } = replySchema.parse(rawBody);
  const [message] = await db.select().from(contactMessage).where(eq(contactMessage.id, id));
  if (!message) throw new NotFoundError("Message not found.");

  const [reply] = await db
    .insert(contactMessageReply)
    .values({
      messageId: id,
      authorUserId: actor.kind === "owner" ? actor.user.id : null,
      body,
    })
    .returning();

  await db.update(contactMessage).set({ status: "replied" }).where(eq(contactMessage.id, id));

  const subject = message.subject ? `Re: ${message.subject} — Fanzia` : "Re: your message to Fanzia";
  let emailSent = true;
  try {
    await sendTransactionalEmail({
      to: message.email,
      subject,
      text: `Hi ${message.name},\n\n${body}\n\n— The Fanzia team`,
    });
  } catch (err) {
    emailSent = false;
    console.error("[contact-inbox] reply email failed:", (err as Error).message);
  }

  await recordAudit(
    {
      actorUserId: actor.kind === "owner" ? actor.user.id : null,
      actorRole: actor.kind === "owner" ? actor.user.role : "ai_operator",
      actorType: actor.kind === "owner" ? "owner" : "ai_operator",
      action: "contact_message.replied",
      entityType: "contact_message",
      entityId: id,
      after: { replyId: reply!.id, to: message.email, emailSent },
    },
    db,
  );
  return { ...reply!, emailSent };
}
