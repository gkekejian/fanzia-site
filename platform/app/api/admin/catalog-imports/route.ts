import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { catalogImport } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { stageCatalogImport, ValidationError } from "@/lib/catalog/import/service";
import { InvalidImportFileError } from "@/lib/catalog/import/parse";

export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const rows = await db.select().from(catalogImport).orderBy(desc(catalogImport.createdAt));
  return NextResponse.json({ imports: rows });
}

/**
 * Upload + stage (build prompt §11 steps 1-4). Not a restricted action —
 * nothing here writes to `product`/`sourcing_route`/`price_epoch` — so
 * both owner and ai_operator can execute it directly.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const imp = await stageCatalogImport({ actor, filename: file.name, buffer });
    return NextResponse.json({ import: imp });
  } catch (err) {
    if (err instanceof InvalidImportFileError || err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
