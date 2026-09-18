import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { supplier } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";

/** Owner-only id/name picker list — used by the allocation-round create form. */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing suppliers");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .orderBy(supplier.name)
    .limit(500);
  return NextResponse.json({ suppliers: rows });
}
