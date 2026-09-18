import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, accountContact } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { createBuyerMagicLink } from "@/lib/auth/buyerMagicLink";
import { sendTransactionalEmail } from "@/lib/email/send";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";
import { isValidContactRole } from "@/lib/users/contactRoles";

/**
 * Invite an additional contact onto a buyer account. The contact gets a
 * magic-link email and can sign into the buyer portal immediately with the
 * granted role — this is how a primary contact adds their purchasing
 * teammate without going through support.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Inviting a buyer contact");
    ownerId = actor.user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const acct = await db.select({ id: account.id, legalName: account.legalName }).from(account).where(eq(account.id, params.id)).limit(1);
  if (!acct[0]) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`admin-contact-invite:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const name = typeof json?.name === "string" ? json.name.trim() : "";
  const email = typeof json?.email === "string" ? json.email.trim().toLowerCase() : "";
  const phone = typeof json?.phone === "string" && json.phone.trim() ? json.phone.trim() : null;
  const role = typeof json?.role === "string" ? json.role : "purchaser";
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!isValidContactRole(role)) return NextResponse.json({ error: "Role must be primary, purchaser, or viewer." }, { status: 400 });

  const dupe = await db.select({ id: accountContact.id }).from(accountContact).where(eq(accountContact.email, email)).limit(1);
  if (dupe[0]) return NextResponse.json({ error: "That email is already a contact on an account." }, { status: 409 });

  const [contact] = await db
    .insert(accountContact)
    .values({ accountId: acct[0].id, name, email, phone, roleOnAccount: role })
    .returning({ id: accountContact.id });

  const link = await createBuyerMagicLink(email);
  if (link) {
    const url = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/api/buyer/auth/magic-link/verify?token=${link.raw}`;
    await sendTransactionalEmail({
      to: email,
      subject: `You've been added to ${acct[0].legalName} on Fanzia wholesale`,
      text: `You've been added as a ${role} on the Fanzia wholesale account for ${acct[0].legalName}.\n\nSign in here:\n\n${url}\n\nThis link expires shortly and can only be used once.`,
    });
  }

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "buyer_contact.invited",
    entityType: "account_contact",
    entityId: contact!.id,
    after: { accountId: acct[0].id, name, email, role },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, contactId: contact!.id });
}
