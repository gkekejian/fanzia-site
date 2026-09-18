import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { db } from "@/db/client";
import {
  internalRestockDraft,
  nayaxMachine,
  nayaxSuggestionRun,
  restockParams,
  slotMap,
} from "@/db/schema/nayax";
import { product } from "@/db/schema/catalog";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { isNayaxConfigured } from "@/lib/nayax/client";
import { weekKeyFor } from "@/lib/nayax/weekly";

/**
 * Owner-only dashboard data for /admin/nayax: machines + planogram,
 * restock params, the latest suggestion run, this week's internal draft,
 * and the configured suggestion day. Read-only.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Nayax dashboard");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const machines = await db.select().from(nayaxMachine).orderBy(nayaxMachine.name);
  const slots = await db
    .select({
      id: slotMap.id,
      machineId: slotMap.machineId,
      slotPosition: slotMap.slotPosition,
      productId: slotMap.productId,
      capacityUnits: slotMap.capacityUnits,
      active: slotMap.active,
      sku: product.sku,
      productName: product.name,
    })
    .from(slotMap)
    .innerJoin(product, eq(slotMap.productId, product.id))
    .orderBy(slotMap.machineId, slotMap.slotPosition);

  const params = await db
    .select({
      productId: restockParams.productId,
      leadTimeDays: restockParams.leadTimeDays,
      safetyStockDays: restockParams.safetyStockDays,
      reviewPeriodDays: restockParams.reviewPeriodDays,
      minOrderUnits: restockParams.minOrderUnits,
      preferredCaseSku: restockParams.preferredCaseSku,
      caseUnits: restockParams.caseUnits,
      trialQty: restockParams.trialQty,
      active: restockParams.active,
      sku: product.sku,
      productName: product.name,
    })
    .from(restockParams)
    .innerJoin(product, eq(restockParams.productId, product.id))
    .orderBy(product.sku);

  const [latestRun] = await db
    .select()
    .from(nayaxSuggestionRun)
    .orderBy(desc(nayaxSuggestionRun.runAt))
    .limit(1);

  const weekKey = weekKeyFor(new Date());
  const [draft] = await db
    .select()
    .from(internalRestockDraft)
    .where(eq(internalRestockDraft.weekKey, weekKey))
    .limit(1);

  const products = await db
    .select({ id: product.id, sku: product.sku, name: product.name })
    .from(product)
    .orderBy(product.sku);

  return NextResponse.json({
    configured: isNayaxConfigured(),
    suggestionDay: await getSetting<string>(SETTINGS_KEYS.suggestionDay, "monday"),
    weekKey,
    machines: machines.map((m) => ({
      ...m,
      slots: slots.filter((s) => s.machineId === m.id),
    })),
    restockParams: params,
    latestRun: latestRun
      ? { weekKey: latestRun.weekKey, runAt: latestRun.runAt, lines: latestRun.lines }
      : null,
    draft: draft ?? null,
    products,
  });
}
