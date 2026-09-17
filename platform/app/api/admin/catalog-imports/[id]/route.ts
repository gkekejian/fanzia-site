import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { getCatalogImportWithRows, NotFoundError } from "@/lib/catalog/import/service";

/** The reviewable diff screen (build prompt §11 step 4). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  try {
    const result = await getCatalogImportWithRows(params.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
