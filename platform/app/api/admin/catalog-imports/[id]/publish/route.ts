import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { publishCatalogImport, NotFoundError, ValidationError } from "@/lib/catalog/import/service";

/**
 * The only endpoint in the import pipeline that can change live prices
 * (build prompt §14) — publishCatalogImport routes ai_operator through
 * agent_proposal instead of executing (test gate #32).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  try {
    const outcome = await publishCatalogImport({ importId: params.id, actor });
    if (!outcome.executed) {
      return NextResponse.json({ ok: true, proposed: true, proposalId: outcome.proposalId });
    }
    return NextResponse.json({ ok: true, proposed: false, import: outcome.result });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
