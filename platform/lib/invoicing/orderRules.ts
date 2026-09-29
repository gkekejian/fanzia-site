import type { PgDatabase } from "drizzle-orm/pg-core";
import { loadConfig, type Config } from "@/lib/config";
import type { OrderRules } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export function orderRulesFromConfig(config: Config): OrderRules {
  return {
    minimumMinor: config.order_minimum_minor,
    smallOrderThresholdMinor: config.small_order_threshold_minor,
    smallOrderFeeMinor: config.small_order_fee_minor,
    firstOrderCapMinor: config.first_order_cap_minor,
    offerExpiryHours: config.offer_expiry_hours,
    caseOnly: config.case_only_mode,
    paused: config.ordering_paused,
    pausedMessage: config.ordering_paused_message,
    allocationMode: config.selling_mode === "allocation",
  };
}

/** Live order rules from the Settings page (defaults when unset or the DB is unreachable). */
export async function getOrderRules(db?: AnyDb): Promise<OrderRules> {
  return orderRulesFromConfig(await loadConfig(db));
}
