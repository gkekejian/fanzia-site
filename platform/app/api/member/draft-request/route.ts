import { NextRequest, NextResponse } from "next/server";
import { requireBuyer } from "@/lib/auth/buyerActor";
import { getDraftRequest, saveDraftRequest, draftRequestInputSchema } from "@/lib/catalog/draftRequest";

export async function GET(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const draft = await getDraftRequest(buyer.accountId);
  return NextResponse.json({ draft: draft ?? { lines: [], notes: null } });
}

/** Save-only — no order, notification, or audit event is created (build prompt §1: "a request is not a sale"). */
export async function PUT(req: NextRequest) {
  const buyer = await requireBuyer(req);
  if (buyer instanceof NextResponse) return buyer;

  const json = await req.json().catch(() => null);
  const parsed = draftRequestInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const draft = await saveDraftRequest(buyer.accountId, parsed.data);
  return NextResponse.json({ ok: true, draft });
}
