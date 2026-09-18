import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { nayaxMachine, nayaxRestock, slotMap } from "@/db/schema/nayax";

/**
 * Owner-only "I restocked machine X" (design §3.3 rule 2): resets the
 * on-hand baseline the suggestion engine derives from sales. Writes one
 * nayax_restock row per slot; unitsRestored defaults to the slot's
 * capacityUnits (a full slot) unless the caller passes explicit units.
 * Append-only — the old baseline stays in history for audit. The endpoint
 * returns the new per-slot on-hand estimates.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Recording a vending restock");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const body = (await req.json().catch(() => null)) as {
    machineId?: string;
    slots?: { slotPosition: number; units?: number }[];
  } | null;
  if (!body?.machineId) {
    return NextResponse.json({ error: "machineId is required." }, { status: 400 });
  }

  const [machine] = await db
    .select()
    .from(nayaxMachine)
    .where(eq(nayaxMachine.id, body.machineId))
    .limit(1);
  if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

  const slots = await db
    .select()
    .from(slotMap)
    .where(and(eq(slotMap.machineId, machine.id), eq(slotMap.active, true)));

  const targets: { slotPosition: number; units?: number }[] =
    body.slots && body.slots.length > 0
      ? body.slots.map((s) => ({ slotPosition: s.slotPosition, units: s.units }))
      : slots.map((s) => ({ slotPosition: s.slotPosition }));

  const now = new Date();
  const recorded: { slotPosition: number; unitsRestored: number }[] = [];
  for (const t of targets) {
    const slot = slots.find((s) => s.slotPosition === t.slotPosition);
    if (!slot) {
      return NextResponse.json(
        { error: `Slot ${t.slotPosition} is not on this machine's planogram.` },
        { status: 400 },
      );
    }
    const unitsRestored = t.units ?? slot.capacityUnits;
    if (!Number.isFinite(unitsRestored) || unitsRestored < 0) {
      return NextResponse.json(
        { error: `Invalid units for slot ${t.slotPosition}.` },
        { status: 400 },
      );
    }
    await db.insert(nayaxRestock).values({
      machineId: machine.id,
      slotPosition: slot.slotPosition,
      productId: slot.productId,
      unitsRestored,
      restockedAt: now,
      // assertOwner above narrows actor to the owner branch.
      recordedBy: actor.user.id,
    });
    recorded.push({ slotPosition: slot.slotPosition, unitsRestored });
  }

  await recordAudit(
    {
      actorType: actor.kind,
      // assertOwner above narrows actor to the owner branch.
      actorUserId: actor.user.id,
      action: "nayax.restock_recorded",
      entityType: "nayax_machine",
      entityId: machine.id,
      after: { machineName: machine.name, recordedAt: now.toISOString(), slots: recorded },
    },
    db,
  );

  return NextResponse.json({ ok: true, machine: machine.name, recordedAt: now.toISOString(), slots: recorded });
}
