import type { PgDatabase } from "drizzle-orm/pg-core";
import { inArray } from "drizzle-orm";
import { settings as settingsTable } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

/**
 * Owner settings registry: every business knob in one typed list, with a
 * safe default, validation bounds, and plain-language help. The Settings
 * page (/admin/settings) renders straight from this list, and all runtime
 * reads go through loadConfig() so a missing/garbled row always falls back
 * to the default instead of crashing a request.
 *
 * Adding a knob = one entry here. No migration, no new page.
 */
export type SettingGroup = "Ordering" | "Allocations" | "Automation" | "Applications" | "Notifications" | "Modules";

type Base<K extends string> = { key: K; label: string; help: string; group: SettingGroup };
export type SettingDef =
  | (Base<string> & { type: "boolean"; default: boolean })
  | (Base<string> & { type: "money"; default: number; min: number; max: number })
  | (Base<string> & { type: "integer"; default: number; min: number; max: number; unit?: string })
  | (Base<string> & { type: "bps"; default: number; min: number; max: number })
  | (Base<string> & { type: "enum"; default: string; options: { value: string; label: string }[] })
  | (Base<string> & { type: "text"; default: string; maxLength: number });

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => ({
  value: d,
  label: d[0]!.toUpperCase() + d.slice(1),
}));

export const SETTING_DEFS = [
  // ── Ordering ──────────────────────────────────────────────────────────
  {
    key: "ordering_paused",
    group: "Ordering",
    type: "boolean",
    default: false,
    label: "Pause all ordering",
    help: "Vacation / out-of-stock switch. Buyers can browse and build drafts but cannot submit. Nothing already submitted is affected.",
  },
  {
    key: "ordering_paused_message",
    group: "Ordering",
    type: "text",
    default: "Ordering is paused for a short break. Your draft is saved and you can submit as soon as we reopen.",
    maxLength: 280,
    label: "Message buyers see while paused",
    help: "Shown at the top of the buyer catalog and on submit.",
  },
  {
    key: "case_only_mode",
    group: "Ordering",
    type: "boolean",
    default: true,
    label: "Sell full cases only",
    help: "Products with a case size set can only be ordered in whole cases, so nothing gets repacked. Products without a case size are unaffected.",
  },
  {
    key: "order_minimum_minor",
    group: "Ordering",
    type: "money",
    default: 50000,
    min: 0,
    max: 10_000_000,
    label: "Order minimum",
    help: "Subtotal a buyer must reach before they can submit.",
  },
  {
    key: "small_order_threshold_minor",
    group: "Ordering",
    type: "money",
    default: 75000,
    min: 0,
    max: 10_000_000,
    label: "Small-order fee applies below",
    help: "External buyers under this subtotal pay the small-order fee.",
  },
  {
    key: "small_order_fee_minor",
    group: "Ordering",
    type: "money",
    default: 2500,
    min: 0,
    max: 100_000,
    label: "Small-order fee",
    help: "Set to $0 to turn the fee off.",
  },
  {
    key: "first_order_cap_minor",
    group: "Ordering",
    type: "money",
    default: 500000,
    min: 0,
    max: 100_000_000,
    label: "First-order cap",
    help: "Largest first order a new account can place. Limits fraud exposure on an unknown buyer.",
  },
  {
    key: "offer_expiry_hours",
    group: "Ordering",
    type: "integer",
    default: 48,
    min: 12,
    max: 336,
    unit: "hours",
    label: "Order request expires after",
    help: "How long a submitted request waits for approval before expiring (one automatic rollover still applies).",
  },
  {
    key: "markup_floor_bps",
    group: "Ordering",
    type: "bps",
    default: 2800,
    min: 0,
    max: 20000,
    label: "Minimum markup",
    help: "Catalog imports and publishing refuse prices below cost plus this markup.",
  },
  // ── Allocations ───────────────────────────────────────────────────────
  {
    key: "selling_mode",
    group: "Allocations",
    type: "enum",
    // Self-serve until the owner switches: deploying this never changes how
    // live buyers order mid-cycle. Open order requests finish normally
    // after the switch; only new submissions stop.
    default: "self_serve",
    options: [
      { value: "allocation", label: "Allocation offers (buyers mark interest, you send offers)" },
      { value: "self_serve", label: "Self-serve ordering (buyers submit order requests)" },
    ],
    label: "How buyers get product",
    help: "Allocation offers: the catalog becomes an interest list and buyers only buy through offers you send from Drops. Self-serve: the old catalog + order requests. Your internal vending account can always order directly. Switch when your first drop is ready; order requests already submitted still finish normally.",
  },
  {
    key: "offer_window_hours",
    group: "Allocations",
    type: "integer",
    default: 48,
    min: 2,
    max: 336,
    unit: "hours",
    label: "Offer window",
    help: "How long a buyer has to Accept & pay before the offer passes to the next buyer.",
  },
  {
    key: "reoffer_window_hours",
    group: "Allocations",
    type: "integer",
    default: 24,
    min: 2,
    max: 336,
    unit: "hours",
    label: "Re-offer window",
    help: "Window for units re-offered automatically after someone declines or lets an offer expire.",
  },
  // ── Automation ────────────────────────────────────────────────────────
  {
    key: "order_auto_approve_max_minor",
    group: "Automation",
    type: "money",
    default: 0,
    min: 0,
    max: 100_000_000,
    label: "Auto-approve repeat orders up to",
    help: "Repeat, tax-exempt buyers with no unpaid invoices are approved and invoiced instantly up to this total. $0 = off; everything waits for you.",
  },
  {
    key: "auto_refund_card_shortfall",
    group: "Automation",
    type: "boolean",
    default: false,
    label: "Auto-refund supplier shortfalls to cards",
    help: "When a supplier ships less than was paid for, refund the difference to the buyer's card automatically when you approve the round. ACH/wire refunds always wait for you.",
  },
  {
    key: "decision_reminder_hours",
    group: "Automation",
    type: "integer",
    default: 24,
    min: 1,
    max: 168,
    unit: "hours",
    label: "Remind me about waiting decisions after",
    help: "One combined reminder email per day when an order request or application has waited this long.",
  },
  // ── Applications ──────────────────────────────────────────────────────
  {
    key: "applications_open",
    group: "Applications",
    type: "boolean",
    default: false,
    label: "Accept new wholesale applications",
    help: "Off sends new buyers to the waitlist. In-flight applications keep working either way.",
  },
  {
    key: "invite_expiry_days",
    group: "Applications",
    type: "integer",
    default: 14,
    min: 1,
    max: 90,
    unit: "days",
    label: "Invite codes expire after",
    help: "Personal invites let one person apply while applications are closed. Single use, tied to their email.",
  },
  // ── Notifications ─────────────────────────────────────────────────────
  {
    key: "owner_email_mode",
    group: "Notifications",
    type: "enum",
    default: "action_needed",
    options: [
      { value: "action_needed", label: "Only when I need to act" },
      { value: "all", label: "Every business event" },
      { value: "digest_only", label: "Weekly digest only" },
    ],
    label: "Owner emails",
    help: "Everything is always in the in-app bell. This only controls email.",
  },
  {
    key: "weekly_digest_enabled",
    group: "Notifications",
    type: "boolean",
    default: true,
    label: "Weekly digest email",
    help: "KPIs, anything waiting on you, and system alerts, in one email.",
  },
  {
    key: "digest_day",
    group: "Notifications",
    type: "enum",
    default: "monday",
    options: WEEKDAYS,
    label: "Digest day",
    help: "Sent with the morning ops run (about 6:30am Pacific).",
  },
  // ── Modules ───────────────────────────────────────────────────────────
  {
    key: "module_vending",
    group: "Modules",
    type: "boolean",
    default: true,
    label: "Vending (Nayax sales + restock suggestions)",
    help: "Your own machines. Daily sales poll and weekly restock draft.",
  },
  {
    key: "module_price_intel",
    group: "Modules",
    type: "boolean",
    default: false,
    label: "Price intelligence",
    help: "Supplier price comparison, FX, market prices. Off hides the screen, its API, and its weekly job.",
  },
  {
    key: "module_ai_operator",
    group: "Modules",
    type: "boolean",
    default: false,
    label: "AI operator chat",
    help: "Dashboard chat assistant and its daily suggestions. Off hides the panel and stops the job.",
  },
  {
    key: "module_accounting",
    group: "Modules",
    type: "boolean",
    default: false,
    label: "Built-in cashbook",
    help: "Simple cash ledger. Leave off if you keep books in your accounting software.",
  },
] as const satisfies readonly SettingDef[];

export type SettingKey = (typeof SETTING_DEFS)[number]["key"];
type DefByKey<K extends SettingKey> = Extract<(typeof SETTING_DEFS)[number], { key: K }>;
export type SettingValue<K extends SettingKey> = DefByKey<K>["default"] extends boolean
  ? boolean
  : DefByKey<K>["default"] extends number
    ? number
    : string;
export type Config = { [K in SettingKey]: SettingValue<K> };

export const MODULE_KEYS = ["module_vending", "module_price_intel", "module_ai_operator", "module_accounting"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const DEF_BY_KEY = new Map<string, SettingDef>(SETTING_DEFS.map((d) => [d.key, d as SettingDef]));

export function settingDef(key: string): SettingDef | undefined {
  return DEF_BY_KEY.get(key);
}

export function defaultConfig(): Config {
  return Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default])) as Config;
}

/**
 * Validate and normalize one incoming value. Returns the clean value, or
 * an error string safe to show the owner.
 */
export function validateSetting(key: string, raw: unknown): { ok: true; value: boolean | number | string } | { ok: false; error: string } {
  const def = DEF_BY_KEY.get(key);
  if (!def) return { ok: false, error: `Unknown setting: ${key}` };
  switch (def.type) {
    case "boolean":
      if (typeof raw !== "boolean") return { ok: false, error: `${def.label}: must be on or off.` };
      return { ok: true, value: raw };
    case "money":
    case "integer":
    case "bps": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
        return { ok: false, error: `${def.label}: must be a whole number.` };
      }
      if (n < def.min || n > def.max) return { ok: false, error: `${def.label}: must be between ${def.min} and ${def.max}.` };
      return { ok: true, value: n };
    }
    case "enum":
      if (typeof raw !== "string" || !def.options.some((o) => o.value === raw)) {
        return { ok: false, error: `${def.label}: not an allowed option.` };
      }
      return { ok: true, value: raw };
    case "text": {
      if (typeof raw !== "string") return { ok: false, error: `${def.label}: must be text.` };
      const v = raw.trim();
      if (v.length === 0) return { ok: false, error: `${def.label}: cannot be empty.` };
      if (v.length > def.maxLength) return { ok: false, error: `${def.label}: ${def.maxLength} characters max.` };
      return { ok: true, value: v };
    }
  }
}

/** Coerce a stored value to the def's type; anything invalid falls back to the default. */
function coerce(def: SettingDef, stored: unknown): boolean | number | string {
  const check = validateSetting(def.key, stored);
  return check.ok ? check.value : def.default;
}

async function resolveDb(db?: AnyDb): Promise<AnyDb> {
  if (db) return db;
  return (await import("@/db/client")).db as unknown as AnyDb;
}

/**
 * One query for every setting. Never throws: if the database is
 * unreachable the defaults are returned and the error is logged, so a DB
 * blip degrades to "default behavior" instead of a 500 on every page.
 */
export async function loadConfig(db?: AnyDb): Promise<Config> {
  const config = defaultConfig() as Record<string, boolean | number | string>;
  try {
    const handle = await resolveDb(db);
    const rows = await handle
      .select()
      .from(settingsTable)
      .where(inArray(settingsTable.key, SETTING_DEFS.map((d) => d.key)));
    for (const row of rows) {
      const def = DEF_BY_KEY.get(row.key);
      if (def) config[row.key] = coerce(def, row.value);
    }
  } catch (err) {
    console.error("[config] could not load settings; using defaults:", (err as Error).message);
  }
  return config as Config;
}

export async function getConfigValue<K extends SettingKey>(key: K, db?: AnyDb): Promise<SettingValue<K>> {
  const config = await loadConfig(db);
  return config[key];
}

export async function isModuleEnabled(key: ModuleKey, db?: AnyDb): Promise<boolean> {
  return (await getConfigValue(key, db)) as boolean;
}

/** Validated batch write. All-or-nothing: any invalid value rejects the whole batch. */
export async function saveSettings(
  changes: Record<string, unknown>,
  db?: AnyDb,
): Promise<{ ok: true; saved: Record<string, boolean | number | string> } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const clean: Record<string, boolean | number | string> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const res = validateSetting(key, raw);
    if (res.ok) clean[key] = res.value;
    else errors.push(res.error);
  }
  if (errors.length > 0) return { ok: false, errors };
  const handle = await resolveDb(db);
  await handle.transaction(async (tx) => {
    for (const [key, value] of Object.entries(clean)) {
      const def = DEF_BY_KEY.get(key)!;
      await tx
        .insert(settingsTable)
        .values({ key, value, description: def.label })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value, description: def.label, updatedAt: new Date() } });
    }
  });
  return { ok: true, saved: clean };
}
