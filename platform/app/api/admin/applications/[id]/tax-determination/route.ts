import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { application } from "@/db/schema";
import { determineTax, NotFoundError, ValidationError } from "@/lib/applications/taxDetermine";
import { requireActor } from "@/lib/auth/actor";

const VALID_STATUSES = new Set(["exempt", "taxable"]);

/**
 * Deliberately a different endpoint from the approve/decline decision
 * (build prompt §8): approving an application never sets tax_status to
 * anything but the safe "pending" default. This is the only code path
 * that can move an account to "exempt", and it always requires evidence.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const rows = await db.select().from(application).where(eq(application.id, params.id)).limit(1);
  const app = rows[0];
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!app.accountId) {
    return NextResponse.json(
      { error: "This application has no account yet. Approve it before recording a tax determination." },
      { status: 400 },
    );
  }

  const json = await req.json().catch(() => null);
  const status = json?.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be exempt or taxable" }, { status: 400 });
  }
  const notes = typeof json?.notes === "string" ? json.notes : "";
  const evidenceObjectKey = typeof json?.evidenceObjectKey === "string" ? json.evidenceObjectKey : null;
  if (!notes) return NextResponse.json({ error: "notes are required" }, { status: 400 });

  try {
    const outcome = await determineTax({
      accountId: app.accountId,
      status: status as "exempt" | "taxable",
      evidenceObjectKey,
      notes,
      actor,
    });
    if (!outcome.executed) {
      return NextResponse.json({ ok: true, proposed: true, proposalId: outcome.proposalId });
    }
    return NextResponse.json({ ok: true, proposed: false, determination: outcome.result });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
