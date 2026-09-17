import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKey } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Revoking an API key");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [updated] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(eq(apiKey.id, params.id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    actorUserId: actor.user.id,
    actorRole: "owner",
    actorType: "owner",
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: updated.id,
  });

  return NextResponse.json({ ok: true });
}
