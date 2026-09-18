import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import {
  getContactThread,
  setContactMessageStatus,
  NotFoundError,
  InvalidStatusError,
} from "@/lib/contactMessages";

/** Single inbox thread with its replies. Read access: owners and ai_operator. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(_req);
  if (actor instanceof NextResponse) return actor;

  try {
    const thread = await getContactThread(params.id);
    return NextResponse.json(thread);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    throw err;
  }
}

/**
 * Change a thread's status (new/open/replied/closed). Restricted to owner
 * sessions — ai_operator reads the inbox but doesn't triage it.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.kind !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const status = json?.status;
  if (typeof status !== "string") {
    return NextResponse.json({ error: "status is required." }, { status: 400 });
  }

  try {
    const message = await setContactMessageStatus(params.id, status, actor);
    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    if (err instanceof InvalidStatusError) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    throw err;
  }
}
