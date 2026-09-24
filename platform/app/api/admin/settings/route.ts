import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { loadConfig, saveSettings, SETTING_DEFS } from "@/lib/config";

async function owner(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return { res: actor };
  try {
    assertOwner(actor, "Settings");
  } catch {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { actor };
}

/** GET: every setting's definition + current value. */
export async function GET(req: NextRequest) {
  const gate = await owner(req);
  if (gate.res) return gate.res;
  const values = await loadConfig(db);
  return NextResponse.json({ definitions: SETTING_DEFS, values });
}

/**
 * POST { changes: { key: value, ... } }. Validated all-or-nothing, audited
 * with before/after for every changed key.
 */
export async function POST(req: NextRequest) {
  const gate = await owner(req);
  if (gate.res) return gate.res;
  const json = await req.json().catch(() => null);
  const changes = json?.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "Body must be { changes: { key: value } }." }, { status: 400 });
  }
  const before = (await loadConfig(db)) as Record<string, unknown>;
  const result = await saveSettings(changes as Record<string, unknown>, db);
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") , errors: result.errors }, { status: 400 });

  const changed = Object.keys(result.saved).filter((k) => before[k] !== result.saved[k]);
  if (changed.length > 0) {
    await recordAudit({
      actorUserId: gate.actor!.user.id,
      actorRole: "owner",
      actorType: "owner",
      action: "settings.updated",
      entityType: "setting",
      entityId: changed.join(","),
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, result.saved[k]])),
    });
  }
  return NextResponse.json({ ok: true, changed, values: await loadConfig(db) });
}
