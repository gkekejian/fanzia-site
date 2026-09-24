import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { syncPaidInvoicesIntoRound } from "@/lib/allocation/fromInvoices";

/**
 * Owner-only. Pulls every PAID invoice line for this round's supplier into
 * the round (idempotent). Replaces hand-typing each buyer's quantities.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Pulling paid orders into a round");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await syncPaidInvoicesIntoRound(db, params.id, actor.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
