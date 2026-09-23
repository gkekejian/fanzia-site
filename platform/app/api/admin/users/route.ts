import { NextRequest, NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { createMagicLink } from "@/lib/auth/magicLink";
import { sendTransactionalEmail } from "@/lib/email/send";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Staff identity management — owner-only, no agent_proposal fallback
 * (build prompt §14.1: ai_operator is blocked from user/role management
 * outright). Owners invite co-owners or ai_operator service identities;
 * invites go out as magic links, same as the normal login flow.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing staff users");
  } catch {
    return forbidden();
  }

  const rows = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      role: userTable.role,
      active: userTable.active,
      lastLoginAt: userTable.lastLoginAt,
      createdAt: userTable.createdAt,
    })
    .from(userTable)
    .orderBy(userTable.createdAt);
  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Inviting a staff user");
    ownerId = actor.user.id;
  } catch {
    return forbidden();
  }

  const ip = clientIp(req.headers);
  if (!(await checkRateLimit(`admin-user-invite:${ip}`, 10, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const email = typeof json?.email === "string" ? json.email.trim().toLowerCase() : "";
  const name = typeof json?.name === "string" ? json.name.trim() : "";
  const role = json?.role;
  if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (role !== "owner" && role !== "ai_operator") {
    return NextResponse.json({ error: "Role must be owner or ai_operator." }, { status: 400 });
  }

  const existing = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  if (existing[0]) return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });

  const [created] = await db.insert(userTable).values({ email, name, role }).returning({ id: userTable.id });
  const link = await createMagicLink(email);
  if (link) {
    const url = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/api/auth/magic-link/verify?token=${link.raw}`;
    await sendTransactionalEmail({
      to: email,
      subject: "You've been invited to the Fanzia platform",
      text: `You've been invited as ${role === "owner" ? "an owner" : "an AI operator"} on the Fanzia wholesale platform.\n\nSign in here:\n\n${url}\n\nThis link expires shortly and can only be used once. Owners must also set up two-factor authentication after signing in.`,
    });
  }

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "staff_user.invited",
    entityType: "user",
    entityId: created!.id,
    after: { email, name, role },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, userId: created!.id });
}
