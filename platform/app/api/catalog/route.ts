import { NextResponse } from "next/server";
import { getPublicCatalog } from "@/lib/catalog/queries";

/**
 * No auth check here at all — this route is reachable by anyone, and its
 * response is the entire surface test gate #1 protects: it must be
 * structurally impossible for a price or availability field to appear in
 * this payload. `getPublicCatalog` returns `PublicProductDTO[]`, a type
 * with no such field (lib/catalog/dto.ts).
 */
export async function GET() {
  const products = await getPublicCatalog();
  return NextResponse.json({ products });
}
