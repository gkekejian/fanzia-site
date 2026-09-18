import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import { accountContact, buyerSession } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";
import { isValidContactRole, normalizeContactRole } from "@/lib/users/contactRoles";

/**
 * Change a buyer contact's role or deactivate/reactivate them.
 * Deactivation immediately kills their login ability and live sessions.
 * Guards: an account must always keep at least one active primary contact —
 * otherwise nobody could manage the account's users afterward.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Managing a buyer contact");
    ownerId = actor.user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(accountContact)
    .where(and(eq(accountContact.id, params.contactId), eq(accountContact.accountId, params.id)))
    .limit(1);
  const contact = rows[0];
  if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });

  const json = await req.json().catch(() => null);
  const updates: { roleOnAccount?: string; active?: boolean } = {};
  if (json?.role !== undefined) {
    if (!isValidContactRole(json.role)) {
      return NextResponse.json({ error: "Role must be primary, purchaser, or viewer." }, { status: 400 });
    }
    updates.roleOnAccount = json.role;
  }
  if (json?.active !== undefined) {
    if (typeof json.active !== "boolean") {
      return NextResponse.json({ error: "The 'active' field must be a boolean." }, { status: 400 });
    }
    updates.active = json.active;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const nextRole = normalizeContactRole(updates.roleOnAccount ?? contact.roleOnAccount);
  const nextActive = updates.active ?? contact.active;
  const wasPrimaryActive = contact.active && normalizeContactRole(contact.roleOnAccount) === "primary";
  const staysPrimaryActive = nextActive && nextRole === "primary";
  if (wasPrimaryActive && !staysPrimaryActive) {
    const [{ value: otherPrimaries } = { value: 0 }] = await db
      .select({ value: count() })
      .from(accountContact)
      .where(
        and(
          eq(accountContact.accountId, params.id),
          eq(accountContact.active, true),
          eq(accountContact.roleOnAccount, "primary"),
        ),
      );
    // The count includes this contact, so <= 1 means it is the last one.
    if (otherPrimaries <= 1) {
      return NextResponse.json(
        { error: "This is the account's last active primary contact. Promote someone else first." },
        { status: 400 },
      );
    }
  }

  await db.update(accountContact).set(updates).where(eq(accountContact.id, contact.id));
  if (updates.active === false) {
    await db
      .update(buyerSession)
      .set({ revokedAt: new Date() })
      .where(eq(buyerSession.accountContactId, contact.id));
  }

  const ip = clientIp(req.headers);
  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "buyer_contact.updated",
    entityType: "account_contact",
    entityId: contact.id,
    before: { roleOnAccount: contact.roleOnAccount, active: contact.active },
    after: updates,
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
