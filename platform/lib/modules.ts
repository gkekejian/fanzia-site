import { NextResponse } from "next/server";
import { isModuleEnabled, type ModuleKey } from "@/lib/config";

export const MODULE_LABELS: Record<ModuleKey, string> = {
  module_vending: "Vending",
  module_price_intel: "Price intelligence",
  module_ai_operator: "AI operator",
  module_accounting: "Cashbook",
};

/**
 * Route guard for optional modules (Settings → Modules). Returns a 404
 * response when the module is off, or null to continue:
 *
 *   const off = await requireModule("module_price_intel");
 *   if (off) return off;
 *
 * Off means off: no screen, no API, no scheduled job. That is what keeps
 * an unused module from costing attention, API spend, or failure alerts.
 */
export async function requireModule(key: ModuleKey): Promise<NextResponse | null> {
  if (await isModuleEnabled(key)) return null;
  return NextResponse.json(
    { error: "module_disabled", module: key, message: `${MODULE_LABELS[key]} is turned off. Turn it on in Settings → Modules.` },
    { status: 404 },
  );
}
