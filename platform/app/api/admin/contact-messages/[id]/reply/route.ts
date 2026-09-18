import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { replyToContactMessage, NotFoundError } from "@/lib/contactMessages";
import { z } from "zod";

/**
 * Reply to a website inbox thread. Stores the reply, emails it to the
 * visitor, and marks the thread "replied". Owner-only: sending mail to a
 * customer is a consequential external action, so ai_operator API keys are
 * not permitted — use the admin UI session.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  try {
    const reply = await replyToContactMessage(params.id, json, actor);
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Reply body is required." }, { status: 400 });
    }
    throw err;
  }
}
