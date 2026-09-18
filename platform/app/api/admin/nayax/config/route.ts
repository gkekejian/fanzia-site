import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import {
  internalRestockDraft,
  nayaxMachine,
  nayaxMachineLocation,
  restockParams,
  slotMap,
} from "@/db/schema/nayax";
import { product } from "@/db/schema/catalog";
import { setSetting, SETTINGS_KEYS } from "@/lib/settings";

type ActionBody = {
  action:
    | "upsert-machine"
    | "upsert-slot"
    | "delete-slot"
    | "upsert-params"
    | "update-draft-lines"
    | "approve-draft"
    | "set-suggestion-day";
  [key: string]: unknown;
};

/**
 * Owner-only Nayax config mutations. Every mutation is audit-logged.
 * The approve-draft action moves the internal draft to 'approved'; the
 * allocation-round workstream consumes approved drafts into the open round
 * (see internal_restock_draft handoff contract).
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Nayax configuration");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const body = (await req.json().catch(() => null)) as ActionBody | null;
  if (!body?.action) return NextResponse.json({ error: "action is required." }, { status: 400 });
  // assertOwner narrows actor to the owner branch; the user id is the audit actor.
  const actorId = actor.user.id;

  const audit = (action: string, entityType: string, after: unknown, entityId?: string | null) =>
    recordAudit(
      { actorType: actor.kind, actorUserId: actorId, action, entityType, entityId, after },
      db,
    );

  switch (body.action) {
    case "upsert-machine": {
      const nayaxMachineId = Number(body.nayaxMachineId);
      const name = String(body.name ?? "").trim();
      const location = body.location as (typeof nayaxMachineLocation.enumValues)[number];
      if (!Number.isFinite(nayaxMachineId) || !name || !["glendale", "lakewood"].includes(location)) {
        return NextResponse.json(
          { error: "nayaxMachineId (number), name, and location (glendale|lakewood) are required." },
          { status: 400 },
        );
      }
      const [machine] = await db
        .insert(nayaxMachine)
        .values({
          nayaxMachineId,
          name,
          location,
          active: body.active !== false,
        })
        .onConflictDoUpdate({
          target: nayaxMachine.nayaxMachineId,
          set: { name, location, active: body.active !== false, updatedAt: new Date() },
        })
        .returning();
      if (!machine) return NextResponse.json({ error: "Could not save machine." }, { status: 500 });
      await audit("nayax.machine_upserted", "nayax_machine", machine, machine.id);
      return NextResponse.json({ ok: true, machine });
    }

    case "upsert-slot": {
      const machineId = String(body.machineId ?? "");
      const slotPosition = Number(body.slotPosition);
      const capacityUnits = Number(body.capacityUnits);
      const skuOrId = String(body.productId ?? body.sku ?? "").trim();
      if (!machineId || !Number.isFinite(slotPosition) || !Number.isFinite(capacityUnits) || !skuOrId) {
        return NextResponse.json(
          { error: "machineId, slotPosition, productId (or sku), and capacityUnits are required." },
          { status: 400 },
        );
      }
      const productRows = await db
        .select({ id: product.id })
        .from(product)
        .where(eq(product.sku, skuOrId.toUpperCase()))
        .limit(1);
      const productId =
        productRows[0]?.id ??
        (await db.select({ id: product.id }).from(product).where(eq(product.id, skuOrId)).limit(1))[0]?.id;
      if (!productId) return NextResponse.json({ error: `Product '${skuOrId}' not found.` }, { status: 404 });

      await db
        .insert(slotMap)
        .values({
          machineId,
          slotPosition: Math.floor(slotPosition),
          productId,
          capacityUnits: Math.floor(capacityUnits),
          active: body.active !== false,
        })
        .onConflictDoNothing({ target: [slotMap.machineId, slotMap.slotPosition] })
        .returning();
      // Update in place when the slot already existed (upsert semantics on
      // the (machine_id, slot_position) unique constraint).
      const [slot] = await db
        .update(slotMap)
        .set({
          productId,
          capacityUnits: Math.floor(capacityUnits),
          active: body.active !== false,
          updatedAt: new Date(),
        })
        .where(and(eq(slotMap.machineId, machineId), eq(slotMap.slotPosition, Math.floor(slotPosition))))
        .returning();
      if (!slot) return NextResponse.json({ error: "Could not save slot." }, { status: 500 });
      await audit("nayax.slot_upserted", "slot_map", slot, slot.id);
      return NextResponse.json({ ok: true, slot });
    }

    case "delete-slot": {
      const machineId = String(body.machineId ?? "");
      const slotPosition = Number(body.slotPosition);
      if (!machineId || !Number.isFinite(slotPosition)) {
        return NextResponse.json({ error: "machineId and slotPosition are required." }, { status: 400 });
      }
      await db
        .delete(slotMap)
        .where(and(eq(slotMap.machineId, machineId), eq(slotMap.slotPosition, Math.floor(slotPosition))));
      await audit("nayax.slot_deleted", "slot_map", { machineId, slotPosition });
      return NextResponse.json({ ok: true });
    }

    case "upsert-params": {
      const productId = String(body.productId ?? "");
      const int = (v: unknown) => Number(v);
      if (!productId) return NextResponse.json({ error: "productId is required." }, { status: 400 });
      const values = {
        productId,
        leadTimeDays: int(body.leadTimeDays ?? 14),
        safetyStockDays: int(body.safetyStockDays ?? 7),
        reviewPeriodDays: int(body.reviewPeriodDays ?? 7),
        minOrderUnits: int(body.minOrderUnits ?? 1),
        preferredCaseSku: body.preferredCaseSku != null ? String(body.preferredCaseSku) : null,
        caseUnits: Math.max(1, Math.floor(int(body.caseUnits ?? 1))),
        trialQty: body.trialQty != null ? Math.max(1, Math.floor(int(body.trialQty))) : null,
        active: body.active !== false,
      };
      const [row] = await db
        .insert(restockParams)
        .values(values)
        .onConflictDoUpdate({
          target: restockParams.productId,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      if (!row) return NextResponse.json({ error: "Could not save params." }, { status: 500 });
      await audit("nayax.params_upserted", "restock_params", row, row.id);
      return NextResponse.json({ ok: true, params: row });
    }

    case "update-draft-lines": {
      const draftId = String(body.draftId ?? "");
      const lines = body.lines;
      if (!draftId || !Array.isArray(lines)) {
        return NextResponse.json({ error: "draftId and lines[] are required." }, { status: 400 });
      }
      const [draft] = await db
        .update(internalRestockDraft)
        .set({ lines, updatedAt: new Date() })
        .where(eq(internalRestockDraft.id, draftId))
        .returning();
      if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
      await audit("nayax.draft_lines_updated", "internal_restock_draft", { lineCount: lines.length }, draft.id);
      return NextResponse.json({ ok: true, draft });
    }

    case "approve-draft": {
      const draftId = String(body.draftId ?? "");
      if (!draftId) return NextResponse.json({ error: "draftId is required." }, { status: 400 });
      const [draft] = await db
        .select()
        .from(internalRestockDraft)
        .where(eq(internalRestockDraft.id, draftId))
        .limit(1);
      if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
      if (draft.status !== "draft") {
        return NextResponse.json(
          { error: `Draft is already '${draft.status}' — only drafts can be approved.` },
          { status: 409 },
        );
      }
      const [approved] = await db
        .update(internalRestockDraft)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(internalRestockDraft.id, draftId))
        .returning();
      await audit(
        "nayax.draft_approved",
        "internal_restock_draft",
        {
          weekKey: draft.weekKey,
          note: "Owner reviewed and approved the internal restock draft. Engine-tagged lines already sit in the open allocation round as INTERNAL requests; allocation happens at round cutoff under the fanzia_first policy.",
        },
        draft.id,
      );
      return NextResponse.json({ ok: true, draft: approved });
    }

    case "set-suggestion-day": {
      const day = String(body.day ?? "").toLowerCase();
      const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      if (!days.includes(day)) {
        return NextResponse.json({ error: `day must be one of: ${days.join(", ")}` }, { status: 400 });
      }
      await setSetting(
        SETTINGS_KEYS.suggestionDay,
        day,
        "Weekday (America/Los_Angeles) the weekly vending restock suggestion runs inside the daily ops sweep.",
      );
      await audit("nayax.suggestion_day_set", "settings", { day });
      return NextResponse.json({ ok: true, day });
    }

    default:
      return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
  }
}
