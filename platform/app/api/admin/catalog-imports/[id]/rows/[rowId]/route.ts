import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { setCatalogImportRowIncluded, NotFoundError, ValidationError } from "@/lib/catalog/import/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; rowId: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  if (typeof json?.included !== "boolean") {
    return NextResponse.json({ error: "included (boolean) is required" }, { status: 400 });
  }

  try {
    const row = await setCatalogImportRowIncluded({
      importId: params.id,
      rowId: params.rowId,
      included: json.included,
      actor,
    });
    return NextResponse.json({ row });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
