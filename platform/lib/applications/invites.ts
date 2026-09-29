import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomInt } from "crypto";
import { account, applicationInvite } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Personal invite codes (docs/allocation-design.md §9): let one specific
 * person apply while the application portal is closed.
 *
 * - The raw code is emailed and shown to the owner once; only its SHA-256
 *   is stored, so a database leak can't be turned into working invites.
 * - Single use, tied to the invitee's email, expires (Settings → Applications).
 * - Consumed inside the same transaction that creates the application, so
 *   one code can never produce two applications.
 */

/** No 0/O/1/I: codes get read aloud and retyped. 32 symbols = 5 bits each. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 3;
const GROUP_LEN = 4; // 12 symbols = 60 bits of entropy

export class InviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LEN; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

/** Case/spacing/dash-insensitive: "abcd efgh-jklm" and "ABCD-EFGH-JKLM" are the same code. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashInviteCode(raw: string): string {
  return hashToken(`invite:${normalizeInviteCode(raw)}`);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteStatus = "active" | "used" | "expired" | "revoked";

export function inviteStatus(
  invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InviteStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function inviteUrl(code: string, baseUrl: string = process.env.APP_BASE_URL ?? "http://localhost:3100"): string {
  return `${baseUrl}/apply?invite=${encodeURIComponent(code)}`;
}

export function buildInviteEmail(args: { name: string; code: string; expiresAt: Date; baseUrl?: string }) {
  const url = inviteUrl(args.code, args.baseUrl);
  const expires = args.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return {
    subject: "Your invitation to apply for a Fanzia wholesale account",
    text:
      `Hi ${args.name},\n\n` +
      `You're invited to apply for a Fanzia wholesale account. New accounts are otherwise closed right now, ` +
      `so this link is just for you:\n\n${url}\n\n` +
      `Your invite code is ${args.code}. It works once, only with this email address, and expires on ${expires}.\n\n` +
      `Have your resale certificate ready to upload. We review every application and email you the result.`,
  };
}

type InviteRow = typeof applicationInvite.$inferSelect;

/**
 * Create an invite. If this email already has an active invite, that one
 * is revoked and replaced (re-sending is the common reason to create a
 * second one). Refuses emails that already belong to an approved account.
 */
export async function createInvite(
  db: AnyDb,
  args: {
    email: string;
    name: string;
    note?: string | null;
    sourceMessageId?: string | null;
    createdBy: string | null;
    expiryDays: number;
    now?: Date;
  },
): Promise<{ invite: InviteRow; code: string; replacedInviteId: string | null }> {
  const email = normalizeEmail(args.email);
  const name = args.name.trim();
  const now = args.now ?? new Date();
  if (!EMAIL_RE.test(email) || email.length > 320) throw new InviteError("Enter a valid email address.");
  if (!name || name.length > 200) throw new InviteError("Enter the person's or business's name (200 characters max).");
  const note = args.note?.trim() ? args.note.trim().slice(0, 1000) : null;
  if (!Number.isInteger(args.expiryDays) || args.expiryDays < 1 || args.expiryDays > 90) {
    throw new InviteError("Invite expiry must be between 1 and 90 days.");
  }

  const [existingAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(sql`lower(${account.primaryContactEmail}) = ${email}`)
    .limit(1);
  if (existingAccount) throw new InviteError("That email already belongs to an approved buyer account.", 409);

  const code = generateInviteCode();
  const expiresAt = new Date(now.getTime() + args.expiryDays * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const replaced = await tx
      .update(applicationInvite)
      .set({ revokedAt: now })
      .where(
        and(
          sql`lower(${applicationInvite.email}) = ${email}`,
          isNull(applicationInvite.usedAt),
          isNull(applicationInvite.revokedAt),
          gt(applicationInvite.expiresAt, now),
        ),
      )
      .returning({ id: applicationInvite.id });
    const [invite] = await tx
      .insert(applicationInvite)
      .values({
        codeHash: hashInviteCode(code),
        codeHint: normalizeInviteCode(code).slice(-4),
        email,
        name,
        note,
        sourceMessageId: args.sourceMessageId ?? null,
        createdBy: args.createdBy,
        expiresAt,
      })
      .returning();
    await recordAudit(
      {
        actorUserId: args.createdBy,
        actorRole: args.createdBy ? "owner" : null,
        actorType: args.createdBy ? "owner" : "system",
        action: "application_invite.created",
        entityType: "application_invite",
        entityId: invite!.id,
        after: { email, expiresAt: expiresAt.toISOString(), replaced: replaced.map((r) => r.id) },
      },
      tx,
    );
    return { invite: invite!, code, replacedInviteId: replaced[0]?.id ?? null };
  });
}

/** Look up a raw code. Returns the invite and its status, or null when no such code exists. */
export async function findInvite(db: AnyDb, rawCode: string, now: Date = new Date()) {
  const normalized = normalizeInviteCode(rawCode);
  if (normalized.length !== CODE_GROUPS * GROUP_LEN) return null;
  const [invite] = await db
    .select()
    .from(applicationInvite)
    .where(eq(applicationInvite.codeHash, hashInviteCode(normalized)))
    .limit(1);
  if (!invite) return null;
  return { invite, status: inviteStatus(invite, now) };
}

/** Buyer-safe explanation for a code that can't be used. */
export function inviteProblem(result: Awaited<ReturnType<typeof findInvite>>, email?: string): string | null {
  if (!result) return "That invite code isn't valid. Check the link in your email.";
  switch (result.status) {
    case "used":
      return "This invite has already been used to apply.";
    case "revoked":
      return "This invite was replaced or withdrawn. Use the most recent invite email you received.";
    case "expired":
      return "This invite has expired. Reply to your invite email and we'll send a new one.";
    case "active":
      break;
  }
  if (email !== undefined && normalizeEmail(email) !== normalizeEmail(result.invite.email)) {
    return "This invite is for a different email address. Apply with the email the invite was sent to.";
  }
  return null;
}

/**
 * Atomically consume an invite for an application. Must run inside the
 * transaction that inserts the application: the conditional UPDATE only
 * succeeds for an active invite whose email matches, so two simultaneous
 * submissions with one code can't both get through.
 */
export async function consumeInvite(
  tx: AnyDb,
  args: { rawCode: string; email: string; applicationId: string; now?: Date },
): Promise<InviteRow | null> {
  const now = args.now ?? new Date();
  const [row] = await tx
    .update(applicationInvite)
    .set({ usedAt: now, usedApplicationId: args.applicationId })
    .where(
      and(
        eq(applicationInvite.codeHash, hashInviteCode(args.rawCode)),
        isNull(applicationInvite.usedAt),
        isNull(applicationInvite.revokedAt),
        gt(applicationInvite.expiresAt, now),
        sql`lower(${applicationInvite.email}) = ${normalizeEmail(args.email)}`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function revokeInvite(db: AnyDb, inviteId: string, ownerId: string): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(applicationInvite)
    .set({ revokedAt: now })
    .where(and(eq(applicationInvite.id, inviteId), isNull(applicationInvite.usedAt), isNull(applicationInvite.revokedAt)))
    .returning({ id: applicationInvite.id });
  if (updated.length === 0) return false;
  await recordAudit(
    {
      actorUserId: ownerId,
      actorRole: "owner",
      actorType: "owner",
      action: "application_invite.revoked",
      entityType: "application_invite",
      entityId: inviteId,
    },
    db,
  );
  return true;
}

export async function listInvites(db: AnyDb, now: Date = new Date(), limit = 200) {
  const rows = await db.select().from(applicationInvite).orderBy(desc(applicationInvite.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    note: r.note,
    codeHint: r.codeHint,
    status: inviteStatus(r, now),
    expiresAt: r.expiresAt.toISOString(),
    usedAt: r.usedAt?.toISOString() ?? null,
    usedApplicationId: r.usedApplicationId,
    sourceMessageId: r.sourceMessageId,
    createdAt: r.createdAt.toISOString(),
  }));
}
