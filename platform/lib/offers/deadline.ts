/**
 * Drop deadlines in Pacific time (the office is in Glendale, CA). Pure:
 * tested in tests/offerDeadline.test.ts, DST included.
 */

export const OFFICE_TZ = "America/Los_Angeles";
export type DeadlinePreset = "friday_5pm" | "sunday_eod";

/** Buyers get at least this long between offers going out and the deadline. */
export const MIN_OFFER_HOURS = 12;
/** Freed units aren't re-offered with less than this left before the deadline. */
export const MIN_REOFFER_MINUTES = 60;

/** Offset of `tz` from UTC at `date`, in ms (e.g. -7h for PDT). */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a Pacific wall-clock time happens. */
export function pacificToUtc(y: number, month: number, day: number, h: number, min: number, sec = 0): Date {
  const guess = Date.UTC(y, month - 1, day, h, min, sec);
  let t = guess - tzOffsetMs(new Date(guess), OFFICE_TZ);
  // Second pass settles the DST boundary.
  t = guess - tzOffsetMs(new Date(t), OFFICE_TZ);
  return new Date(t);
}

/** Pacific calendar date parts for an instant. */
export function pacificParts(date: Date): { y: number; month: number; day: number; weekday: number; h: number; min: number } {
  const shifted = new Date(date.getTime() + tzOffsetMs(date, OFFICE_TZ));
  return {
    y: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

/**
 * The next Friday 5:00 PM or Sunday 11:59 PM (Pacific) that is at least a
 * day away, so a drop sent today never closes a few hours later.
 */
export function nextDeadline(preset: DeadlinePreset, now: Date): Date {
  const targetDay = preset === "friday_5pm" ? 5 : 0;
  const [h, m] = preset === "friday_5pm" ? [17, 0] : [23, 59];
  const today = pacificParts(now);
  for (let add = 0; add < 15; add++) {
    const base = new Date(Date.UTC(today.y, today.month - 1, today.day + add));
    if (base.getUTCDay() !== targetDay) continue;
    const at = pacificToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m);
    if (at.getTime() - now.getTime() >= 24 * 3_600_000) return at;
  }
  throw new Error("unreachable: a matching weekday occurs within 15 days");
}

/** "Fri, Oct 3, 5:00 PM PDT" */
export function formatDeadline(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: OFFICE_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Expected arrival at the office: offers close + lead time. "Oct 13 – Oct 18" */
export function arrivalRange(closeAt: Date, minDays: number, maxDays: number): { from: Date; to: Date; label: string } {
  const from = new Date(closeAt.getTime() + minDays * 86_400_000);
  const to = new Date(closeAt.getTime() + maxDays * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: OFFICE_TZ, month: "short", day: "numeric" });
  return { from, to, label: minDays === maxDays ? fmt(from) : `${fmt(from)} – ${fmt(to)}` };
}

/** Parse an owner-entered Pacific "YYYY-MM-DDTHH:mm" (datetime-local). */
export function parsePacificLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59) return null;
  return pacificToUtc(y!, mo!, d!, h!, mi!);
}

/** The inverse, for prefilling a datetime-local input. */
export function toPacificLocal(date: Date): string {
  const p = pacificParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.month)}-${pad(p.day)}T${pad(p.h)}:${pad(p.min)}`;
}
