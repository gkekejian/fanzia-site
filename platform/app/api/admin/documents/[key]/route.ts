import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { applicationDocument } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { readLocalObject, isR2Configured } from "@/lib/storage";

/**
 * Only reachable in local/dev mode (lib/storage/index.ts returns a real R2
 * signed URL instead of this path when R2 is configured). Requires an
 * authenticated admin actor — documents are never served from a public or
 * guessable path (build prompt §13).
 */
export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  if (isR2Configured()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db.select().from(applicationDocument).where(eq(applicationDocument.storageKey, params.key)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await readLocalObject(params.key).catch(() => null);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeVerified,
      "Content-Disposition": `inline; filename="${doc.originalFilename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
