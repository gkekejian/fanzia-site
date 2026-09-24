import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { markRefundResolved } from "@/lib/allocation/fromInvoices";

const METHODS = new Set(["ach", "wire", "card", "check", "credit"]);

/** Owner marks a refund as paid back. Body: { method: "ach" | "wire" | "card" | "check" | "credit" } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Resolving a refund");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => ({}));
  const method = typeof json?.method === "string" ? json.method : "";
  if (!METHODS.has(method)) {
    return NextResponse.json({ error: "method must be one of ach, wire, card, check, credit." }, { status: 400 });
  }
  const ok = await markRefundResolved(db, params.id, actor.user.id, method);
  if (!ok) return NextResponse.json({ error: "Refund not found or already resolved." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
