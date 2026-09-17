import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKey, user as userTable } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { generateApiKey } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

/**
 * Issuing (or listing) API keys is user/role-adjacent credential
 * management — owner-only, full stop, with no agent_proposal fallback
 * (build prompt §14.1: ai_operator is blocked from user/role management
 * outright, not routed through the proposal queue). The raw key is
 * returned exactly once, in this response body; only its hash is ever
 * stored (db/schema/user.ts).
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing API keys");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      userId: apiKey.userId,
      userName: userTable.name,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })
    .from(apiKey)
    .innerJoin(userTable, eq(apiKey.userId, userTable.id));

  return NextResponse.json({ apiKeys: rows });
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Issuing an API key");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const targetUserId = typeof json?.userId === "string" ? json.userId : null;
  if (!targetUserId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const [targetUser] = await db.select().from(userTable).where(eq(userTable.id, targetUserId)).limit(1);
  if (!targetUser || targetUser.role !== "ai_operator") {
    return NextResponse.json({ error: "userId must belong to an ai_operator service account" }, { status: 400 });
  }

  const scopes = Array.isArray(json?.scopes) && json.scopes.every((s: unknown) => typeof s === "string")
    ? (json.scopes as string[])
    : ["read"];

  const { raw, prefix, hash } = generateApiKey();
  const [created] = await db
    .insert(apiKey)
    .values({ userId: targetUser.id, keyHash: hash, keyPrefix: prefix, scopes, createdBy: actor.user.id })
    .returning({ id: apiKey.id, keyPrefix: apiKey.keyPrefix, scopes: apiKey.scopes, createdAt: apiKey.createdAt });

  await recordAudit({
    actorUserId: actor.user.id,
    actorRole: "owner",
    actorType: "owner",
    action: "api_key.issued",
    entityType: "api_key",
    entityId: created!.id,
    after: { userId: targetUser.id, keyPrefix: prefix, scopes },
  });

  return NextResponse.json({ ok: true, apiKey: created, rawKey: raw });
}
