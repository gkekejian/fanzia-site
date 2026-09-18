import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { performOrPropose } from "@/lib/auth/rbac";
import {
  applySupplierPriceUpload,
  prepareSupplierPriceUpload,
  ValidationError,
} from "@/lib/priceIntel/service";

/**
 * CSV supplier price-list upload (owner or ai_operator). Template:
 *
 *   sku,unit_price,currency,moq,case_size,shipping_terms,valid_from,notes
 *   KP-001,1500,JPY,10,36,DDP air freight,2026-09-18,September price list
 *   HW-002,145.00,USD,5,12,,2026-09-18,
 *
 * Rules:
 * - unit_price is in MAJOR currency units (converted to minor using the
 *   currency table's exponent: 1500 JPY → 1500 minor; 145.00 USD → 14500).
 * - sku must match a product.sku exactly; currency must be a seeded code.
 * - valid_from is YYYY-MM-DD, defaults to now.
 *
 * The upload parses and stores the raw file as an artifact first (safe for
 * both actors — no live price rows yet). The price writes themselves go
 * through performOrPropose("price_intel.price_update"): owners execute
 * directly (audited with old/new + source list); the ai_operator path
 * queues an agent_proposal for owner approval instead.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const supplierId = formData?.get("supplierId");
  const notes = formData?.get("notes");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  if (typeof supplierId !== "string" || !supplierId) {
    return NextResponse.json({ error: "supplierId is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const { rows, fileKey } = await prepareSupplierPriceUpload({
      supplierId,
      buffer,
      originalFilename: file.name,
    });

    const payload = {
      kind: "supplier_price_upload",
      supplierId,
      rows,
      fileKey,
      originalFilename: file.name,
      notes: typeof notes === "string" ? notes : undefined,
    };
    const result = await performOrPropose(
      actor,
      "price_intel.price_update",
      { type: "supplier_price_list" },
      payload,
      () =>
        applySupplierPriceUpload({
          actor,
          supplierId,
          rows,
          fileKey,
          originalFilename: file.name,
          notes: typeof notes === "string" ? notes : undefined,
        }),
    );

    if (!result.executed) {
      return NextResponse.json(
        { queued: true, proposalId: result.proposalId, parsedRows: rows.length },
        { status: 202 },
      );
    }
    return NextResponse.json({
      applied: true,
      listId: result.result.listId,
      rowCount: result.result.rowCount,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
