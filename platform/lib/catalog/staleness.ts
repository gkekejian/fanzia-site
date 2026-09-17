import { getSetting, SETTINGS_KEYS } from "@/lib/settings";

export type SourceCheckConfidence = "observed" | "quoted" | "confirmed";

/**
 * Build prompt §5 staleness defaults: observed 72h, quoted 7d, confirmed
 * per the supplier's stated terms (no supplier terms are configured yet in
 * this build, so `confirmed` falls back to a conservative 30-day settings
 * default rather than never expiring).
 */
export async function computeValidUntil(confidence: SourceCheckConfidence, checkedAt: Date): Promise<Date> {
  if (confidence === "observed") {
    const hours = await getSetting<number>(SETTINGS_KEYS.sourceCheckStalenessObservedHours, 72);
    return new Date(checkedAt.getTime() + hours * 60 * 60 * 1000);
  }
  if (confidence === "quoted") {
    const days = await getSetting<number>(SETTINGS_KEYS.sourceCheckStalenessQuotedDays, 7);
    return new Date(checkedAt.getTime() + days * 24 * 60 * 60 * 1000);
  }
  const days = await getSetting<number>(SETTINGS_KEYS.sourceCheckStalenessConfirmedDays, 30);
  return new Date(checkedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isExpired(validUntil: Date, now: Date = new Date()): boolean {
  return validUntil.getTime() <= now.getTime();
}

/**
 * Buyer-safe language for a source check's confidence, deliberately never
 * using "reserved," "held," "secured," or "guaranteed" (build prompt §5 /
 * test gate #35).
 */
export const CONFIDENCE_LABEL: Record<string, string> = {
  estimated: "Estimated, not yet confirmed with our source",
  observed: "Checked with our source",
  quoted: "Quoted by our source",
  confirmed: "Confirmed by our source",
};
