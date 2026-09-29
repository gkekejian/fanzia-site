import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { loadConfig } from "@/lib/config";
import { sendNotificationEmail } from "@/lib/email/send";
import { buildInviteEmail, createInvite, InviteError, inviteUrl, listInvites } from "@/lib/applications/invites";

/**
 * Owner-only personal invite codes (docs/allocation-design.md §9).
 *
 * GET  -> { invites: [...] } newest first, with status active/used/expired/revoked
 * POST -> { email, name, note?, sourceMessageId? } creates an invite, emails
 *         it to the invitee, and returns the link ONCE (only a hash is stored).
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  return NextResponse.json({ invites: await listInvites(db) });
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });

  const json = await req.json().catch(() => null);
  if (!json || typeof json.email !== "string" || typeof json.name !== "string") {
    return NextResponse.json({ error: "Enter a name and an email address." }, { status: 400 });
  }
  const config = await loadConfig(db);
  try {
    const { invite, code } = await createInvite(db, {
      email: json.email,
      name: json.name,
      note: typeof json.note === "string" ? json.note : null,
      sourceMessageId: typeof json.sourceMessageId === "string" && json.sourceMessageId ? json.sourceMessageId : null,
      createdBy: actor.user.id,
      expiryDays: config.invite_expiry_days,
    });
    const email = buildInviteEmail({ name: invite.name, code, expiresAt: invite.expiresAt });
    // Best-effort: a failed send is queued for retry; the owner also gets the
    // link below to share another way.
    await sendNotificationEmail({ to: invite.email, subject: email.subject, text: email.text }, "application_invite.sent");
    return NextResponse.json({
      invite: { id: invite.id, email: invite.email, name: invite.name, expiresAt: invite.expiresAt.toISOString() },
      code,
      link: inviteUrl(code),
    });
  } catch (err) {
    if (err instanceof InviteError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
