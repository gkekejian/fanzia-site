import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, eq, inArray, lte } from "drizzle-orm";
import { application, orderRequest } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export const DECISION_REMINDER_KEY = "decision_reminder_last_sent_on";

/**
 * Contingency for owner latency: order requests expire, applicants give
 * up. If anything has waited longer than `thresholdHours`, send ONE
 * combined reminder per day (never one email per item).
 */
export async function maybeSendDecisionReminder(
  db: AnyDb,
  opts: {
    now: Date;
    thresholdHours: number;
    notify: (e: { title: string; body: string }) => Promise<void>;
  },
): Promise<{ sent: boolean; orders: number; applications: number }> {
  const today = opts.now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const cutoff = new Date(opts.now.getTime() - opts.thresholdHours * 60 * 60 * 1000);

  const [o] = await db
    .select({ n: count() })
    .from(orderRequest)
    .where(and(eq(orderRequest.status, "submitted"), lte(orderRequest.createdAt, cutoff)));
  const [a] = await db
    .select({ n: count() })
    .from(application)
    .where(and(inArray(application.status, ["submitted", "needs_review"]), lte(application.createdAt, cutoff)));
  const orders = Number(o?.n ?? 0);
  const applications = Number(a?.n ?? 0);
  if (orders + applications === 0) return { sent: false, orders, applications };
  if ((await getSetting<string | null>(DECISION_REMINDER_KEY, null, db)) === today) return { sent: false, orders, applications };

  const parts = [
    orders ? `${orders} order request(s)` : null,
    applications ? `${applications} application(s)` : null,
  ].filter(Boolean);
  await opts.notify({
    title: `Waiting on you: ${parts.join(" and ")}`,
    body:
      `${parts.join(" and ")} have waited more than ${opts.thresholdHours} hours. ` +
      `Order requests expire if nobody decides. Tip: raise "Auto-approve repeat orders up to" in Settings so routine reorders skip this queue.`,
  });
  await setSetting(DECISION_REMINDER_KEY, today, "Date (America/Los_Angeles) the waiting-decisions reminder last went out", db);
  return { sent: true, orders, applications };
}
