import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/auth/actor";
import { updateProductFields, NotFoundError } from "@/lib/catalog/product";

const bodySchema = z.object({
  status: z.enum(["draft", "active", "inactive"]).optional(),
  publiclyVisible: z.boolean().optional(),
  imageStatus: z.string().max(60).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateProductFields({ productId: params.id, ...parsed.data, actor });
    return NextResponse.json({ product: updated });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
