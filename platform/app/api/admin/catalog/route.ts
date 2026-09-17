import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { getAdminCatalog } from "@/lib/catalog/queries";

/**
 * Every product regardless of status/visibility, with the cost stack
 * included only when the actor is entitled to see it (test gate #33) —
 * getAdminCatalog checks lib/auth/rbac.ts's canSeeCostStack(actor)
 * internally, so there is no separate branch here to get wrong.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const products = await getAdminCatalog(actor);
  return NextResponse.json({ products });
}
