import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { approveCatalogImport, NotFoundError, ValidationError } from "@/lib/catalog/import/service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  try {
    const imp = await approveCatalogImport({ importId: params.id, actor });
    return NextResponse.json({ import: imp });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
