import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/auth/actor";
import { createSourceCheck, NotFoundError } from "@/lib/catalog/sourceCheck";

const bodySchema = z.object({
  stockObserved: z.number().int().nonnegative().nullable().optional().default(null),
  priceObservedMinor: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  method: z.enum(["member_page", "email_quote", "phone", "supplier_confirmation"]),
  confidence: z.enum(["observed", "quoted", "confirmed"]),
  evidenceObjectKey: z.string().optional().nullable(),
});

/**
 * Manually refresh a stock/price observation for a route (build prompt §11
 * Action Center: "Source checks expiring"). Not restricted — evidence
 * recording never sets a live price (see lib/catalog/sourceCheck.ts).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const check = await createSourceCheck({
      sourcingRouteId: params.id,
      stockObserved: parsed.data.stockObserved ?? null,
      priceObservedMinor: parsed.data.priceObservedMinor,
      currencyCode: parsed.data.currencyCode,
      method: parsed.data.method,
      confidence: parsed.data.confidence,
      evidenceObjectKey: parsed.data.evidenceObjectKey ?? null,
      actor,
    });
    return NextResponse.json({ sourceCheck: check });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
