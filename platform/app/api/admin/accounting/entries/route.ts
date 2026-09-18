import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { cashbookEntry } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { runningBalance, validateManualEntry } from "@/lib/accounting/cashbook";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Full ledger, newest first, with a running balance on every row. Filters:
 * ?direction=in|out &category=… &from=YYYY-MM-DD &to=YYYY-MM-DD. The running
 * balance always reflects the complete ledger, not the filtered view.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Listing cashbook entries");
  } catch {
    return forbidden();
  }

  const all = await db.select().from(cashbookEntry);
  const withBalance = runningBalance(all);

  const direction = req.nextUrl.searchParams.get("direction");
  const category = req.nextUrl.searchParams.get("category");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const filtered = withBalance
    .filter(
      (e) =>
        (!direction || e.direction === direction) &&
        (!category || e.category === category) &&
        (!from || e.entryDate >= from) &&
        (!to || e.entryDate <= to),
    )
    .sort((a, b) => {
      if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? 1 : -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  return NextResponse.json({ entries: filtered });
}

/**
 * Manual entry — refunds, expenses, owner contributions, adjustments.
 * referenceType/referenceId stay NULL so these are never confused with
 * auto-posted payment rows.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  let ownerId: string;
  try {
    assertOwner(actor, "Creating a cashbook entry");
    ownerId = actor.user.id;
  } catch {
    return forbidden();
  }

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`accounting-entry:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const err = validateManualEntry(json ?? {});
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const notes = typeof json.notes === "string" && json.notes.trim() ? json.notes.trim().slice(0, 500) : null;
  const [row] = await db
    .insert(cashbookEntry)
    .values({
      entryDate: json.entryDate,
      direction: json.direction,
      amountMinor: json.amountMinor,
      category: json.category,
      referenceType: null,
      referenceId: null,
      notes,
      createdBy: ownerId,
    })
    .returning({ id: cashbookEntry.id });

  await recordAudit({
    actorUserId: ownerId,
    actorRole: "owner",
    actorType: "owner",
    action: "cashbook_entry.created",
    entityType: "cashbook_entry",
    entityId: row!.id,
    after: { entryDate: json.entryDate, direction: json.direction, amountMinor: json.amountMinor, category: json.category, notes },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, entryId: row!.id });
}
