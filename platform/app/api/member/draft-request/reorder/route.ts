import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { reorderDraftFromInvoice, ReorderNotFoundError } from "@/lib/catalog/reorder";
import { canOrder } from "@/lib/users/contactRoles";

const reorderSchema = z.object({ invoiceId: z.string().uuid() });

/**
 * One-click reorder: copies an invoice's lines into the buyer's draft.
 * Auth + role gating here; the mapping/merging rules live in
 * lib/catalog/reorder.ts (unit-tested there).
 */
export async function POST(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;
  if (!canOrder(buyer.contactRole)) {
    return NextResponse.json({ error: "Your account role is view-only. Ask your account's primary contact for ordering access." }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
  }

  try {
    const result = await reorderDraftFromInvoice(buyer.accountId, parsed.data.invoiceId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReorderNotFoundError) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    throw err;
  }
}
