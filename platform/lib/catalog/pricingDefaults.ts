import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Build prompt §9 starting assumptions — configurable, never hard-coded
 * into pricing logic beyond the fallback used before an owner has visited
 * settings: "Seed imports at 35% markup and domestic routes at 17.5%
 * markup as configurable assumptions."
 */
export async function defaultMarkupBpsForRouteType(
  routeType: "import" | "domestic",
  db: AnyDb = defaultDb,
): Promise<number> {
  const key = routeType === "import" ? SETTINGS_KEYS.importMarkupBpsDefault : SETTINGS_KEYS.domesticMarkupBpsDefault;
  const fallback = routeType === "import" ? 3500 : 1750;
  return getSetting<number>(key, fallback, db);
}
