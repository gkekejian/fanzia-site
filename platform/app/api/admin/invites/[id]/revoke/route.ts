import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { revokeInvite } from "@/lib/applications/invites";

/** Owner-only: withdraw an unused invite so its code stops working. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  const ok = await revokeInvite(db, params.id, actor.user.id);
  if (!ok) return NextResponse.json({ error: "Invite not found, already used, or already revoked." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
