import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { account, accountContact, taxDetermination } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { INTERNAL_BUYER_LEGAL_NAME } from "@/lib/internalBuyer";

/**
 * Provisions the internal buyer account ("Fanzia Vending — Internal",
 * kind='internal') — owner-only. Fanzia does not go through the
 * application flow to buy from itself (Fanzia-as-client design
 * 2026-09-18 §1.2): this is a direct provisioning action that skips
 * triage entirely, marks the account tax-exempt by reference to Fanzia's
 * own on-file seller's permits, and audit-logs everything.
 *
 * Idempotent: if an internal-kind account already exists it is returned
 * with provisioned:false instead of inserting a second one.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Provisioning the internal buyer");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [existing] = await db
    .select()
    .from(account)
    .where(eq(account.kind, "internal"))
    .limit(1);

  let internalAccount = existing ?? null;
  let provisioned = false;
  if (!internalAccount) {
    // Optional body overrides for the notNull address/contact fields; the
    // defaults are placeholders until George confirms Fanzia, Inc.'s
    // registered address. Never invent a real-looking address here.
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pick = (k: string, fallback: string) =>
      typeof body[k] === "string" && body[k] !== "" ? (body[k] as string) : fallback;
    const addressLine2 =
      typeof body.addressLine2 === "string" && body.addressLine2 !== ""
        ? body.addressLine2
        : null;

    const [created] = await db
      .insert(account)
      .values({
        legalName: INTERNAL_BUYER_LEGAL_NAME,
        channelType: "vending",
        kind: "internal",
        // Tax posture (design §1.2): exempt *because buyer and supplier are
        // the same legal entity* — Fanzia, Inc. resale. No CDTFA-230 flows
        // in either direction here. Recorded via the tax_determination
        // table like every other determination, never as a bare column flip.
        taxStatus: "exempt",
        addressLine1: pick("addressLine1", "ADDRESS TBD — Fanzia, Inc. storefront"),
        addressLine2,
        city: pick("city", "Glendale"),
        state: pick("state", "CA"),
        postalCode: pick("postalCode", "TBD"),
        primaryContactName: pick("primaryContactName", "George Kekejian"),
        primaryContactEmail: pick("primaryContactEmail", "george@fanzia.io"),
      })
      .returning();

    const [determination] = await db
      .insert(taxDetermination)
      .values({
        accountId: created!.id,
        status: "exempt",
        notes:
          "internal — Fanzia, Inc. resale; on-file seller's permits (Glendale + Lakewood). " +
          "No resale certificate needed: buyer and supplier are the same legal entity, so no " +
          "CDTFA-230 flows in either direction.",
        determinedBy: actor.user.id,
      })
      .returning();

    // audit_log has no actor_buyer_kind column — the tag goes in the JSON
    // `after` payload so anyone reading the log sees at a glance that this
    // volume was ours (design §1.3).
    await recordAudit({
      actorUserId: actor.user.id,
      actorRole: "owner",
      actorType: "owner",
      action: "internal_buyer.provision",
      entityType: "account",
      entityId: created!.id,
      after: {
        actor_buyer_kind: "internal",
        accountId: created!.id,
        legalName: created!.legalName,
        kind: created!.kind,
        taxDeterminationId: determination!.id,
      },
    });

    internalAccount = created!;
    provisioned = true;
  }

  // Buyer magic-link login resolves strictly by account_contact.email, so
  // the internal account needs a contact row before anyone can sign in as
  // it at /member/login. The contact belongs to the owner who enabled it —
  // they browse the customer side exactly like a real buyer, and their
  // buyer actions audit-log as actorType "buyer" against the internal
  // account, fully separate from their owner actions.
  const ownerEmail = actor.user.email.toLowerCase();
  const [existingContact] = await db
    .select()
    .from(accountContact)
    .where(
      and(
        eq(accountContact.accountId, internalAccount.id),
        eq(accountContact.email, ownerEmail),
      ),
    )
    .limit(1);
  let buyerContact: typeof existingContact = existingContact ?? undefined;
  if (!buyerContact) {
    [buyerContact] = await db
      .insert(accountContact)
      .values({
        accountId: internalAccount.id,
        name: actor.user.name,
        email: ownerEmail,
        roleOnAccount: "owner",
        active: true,
      })
      .returning();
    await recordAudit({
      actorUserId: actor.user.id,
      actorRole: "owner",
      actorType: "owner",
      action: "internal_buyer.buyer_login_enabled",
      entityType: "account_contact",
      entityId: buyerContact!.id,
      after: {
        actor_buyer_kind: "internal",
        accountId: internalAccount.id,
        contactId: buyerContact!.id,
        email: ownerEmail,
      },
    });
  }

  return NextResponse.json(
    {
      account: internalAccount,
      provisioned,
      buyerContact: { id: buyerContact!.id, email: buyerContact!.email },
      buyerLoginReady: true,
    },
    { status: provisioned ? 201 : 200 },
  );
}
