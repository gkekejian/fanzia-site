import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { computeKpis } from "@/lib/analytics/kpis";
import { buildDigest } from "@/lib/analytics/digest";
import { getActionQueue } from "@/lib/ops/today";
import { runHealthChecks } from "@/lib/ops/health";
import { sendTransactionalEmail } from "@/lib/email/send";

/**
 * GET: preview this week's digest. POST: email it to yourself now (to
 * check delivery without waiting for the digest day).
 */
async function build() {
  const now = new Date();
  const [k, queue, health] = await Promise.all([computeKpis(db, { days: 7, now }), getActionQueue(db, now), runHealthChecks(db, now)]);
  return buildDigest(k, queue, health, process.env.APP_BASE_URL ?? "https://app.fanzia.io");
}

async function gate(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return { res: actor };
  try {
    assertOwner(actor, "Digest");
  } catch {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { actor };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  return NextResponse.json(await build());
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  const digest = await build();
  try {
    await sendTransactionalEmail({ to: g.actor!.user.email, subject: `[Preview] ${digest.subject}`, text: digest.text });
    return NextResponse.json({ ok: true, sentTo: g.actor!.user.email });
  } catch (err) {
    return NextResponse.json({ error: `Send failed: ${(err as Error).message}` }, { status: 502 });
  }
}
