import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
// Direct module import (not the barrel) until the schema coordinator wires
// 0019's tables into db/schema/index.ts.
import { poPack } from "@/db/schema/distributor";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { toCsv, toPrintableHtml, type PoPack } from "@/lib/po/pack";

/**
 * GET /api/admin/po-packs/[id]/download?format=csv|html — owner-only.
 * Returns the stored pack as a downloadable CSV (portal import/manual
 * entry) or print-friendly HTML (print-to-PDF is the v1 artifact).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Downloading a distributor PO pack");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const format = req.nextUrl.searchParams.get("format");
  if (format !== "csv" && format !== "html") {
    return NextResponse.json({ error: "format must be csv or html" }, { status: 400 });
  }

  const rows = await db.select().from(poPack).where(eq(poPack.id, params.id)).limit(1);
  const stored = rows[0];
  if (!stored) return NextResponse.json({ error: "PO pack not found" }, { status: 404 });

  const pack = stored.payload as PoPack;
  const slug = `${stored.roundRef}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "po-pack";

  if (format === "csv") {
    return new NextResponse(toCsv(pack), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-po.csv"`,
      },
    });
  }

  return new NextResponse(toPrintableHtml(pack), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-po.html"`,
    },
  });
}
