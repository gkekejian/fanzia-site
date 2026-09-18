import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { listContactMessages, InvalidStatusError } from "@/lib/contactMessages";

/** Website inbox queue. Read access: owners and ai_operator (full read access). */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const status = req.nextUrl.searchParams.get("status") || undefined;
  try {
    const messages = await listContactMessages(status);
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof InvalidStatusError) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    throw err;
  }
}
