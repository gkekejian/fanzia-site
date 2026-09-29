import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { createDrop, listDrops } from "@/lib/offers/drops";
import { OfferError } from "@/lib/offers/context";

/** Owner-only allocation drops (docs/allocation-design.md §3). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  return NextResponse.json({ drops: await listDrops(db) });
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  const json = await req.json().catch(() => ({}));
  try {
    const drop = await createDrop(db, actor.user.id, { name: json?.name, supplierId: json?.supplierId, notes: json?.notes, offersCloseAt: json?.offersCloseAt });
    return NextResponse.json({ ok: true, drop });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
