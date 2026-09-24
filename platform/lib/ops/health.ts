import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, count, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import journal from "@/db/migrations/meta/_journal.json";
import { account, emailOutbox, notification, orderRequest, refundDue } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { loadConfig } from "@/lib/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export type CheckStatus = "ok" | "warn" | "fail";
export type HealthCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What the owner should do, in plain words. Omitted when nothing is needed. */
  fix?: string;
};
export type HealthReport = { ok: boolean; status: CheckStatus; checkedAt: string; checks: HealthCheck[] };

export const OPS_SWEEP_HEARTBEAT_KEY = "ops_sweep_last_run_at";
export const OPS_SWEEP_RESULT_KEY = "ops_sweep_last_result";
/** Daily cron + slack for Vercel's scheduling jitter. */
export const HEARTBEAT_MAX_AGE_HOURS = 26;

const HOUR = 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

/**
 * Pure check for configuration: which integrations are wired. Only
 * booleans ever leave this function; secret values are never read out.
 */
export function configChecks(env: Env): HealthCheck[] {
  const prod = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const has = (k: string) => Boolean(env[k] && env[k]!.trim());
  const checks: HealthCheck[] = [];

  checks.push(
    has("RESEND_API_KEY")
      ? { key: "email_config", label: "Email sending", status: "ok", detail: "Resend is configured." }
      : {
          key: "email_config",
          label: "Email sending",
          status: prod ? "fail" : "warn",
          detail: "RESEND_API_KEY is not set. Emails (sign-in links, invoices) are only written to logs.",
          fix: "Add RESEND_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
        },
  );

  const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].every(has);
  checks.push(
    r2
      ? { key: "storage_config", label: "Document storage", status: "ok", detail: "Cloudflare R2 is configured." }
      : {
          key: "storage_config",
          label: "Document storage",
          status: prod ? "fail" : "warn",
          detail:
            "R2 is not configured, so uploads (resale certificates) go to the server's local disk. On Vercel that disk is temporary: files are lost or the upload fails.",
          fix: "Create an R2 bucket and set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.",
        },
  );

  const stripeKey = has("STRIPE_SECRET_KEY");
  const stripeHook = has("STRIPE_WEBHOOK_SECRET");
  checks.push(
    stripeKey && stripeHook
      ? { key: "payments_config", label: "Card payments", status: "ok", detail: "Stripe key and webhook secret are set." }
      : stripeKey !== stripeHook
        ? {
            key: "payments_config",
            label: "Card payments",
            status: "fail",
            detail: stripeKey
              ? "Stripe key is set but the webhook secret is not: buyers can pay, but payments will never be recorded."
              : "Webhook secret is set but the Stripe key is not: buyers cannot start card checkout.",
            fix: "Set both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
          }
        : {
            key: "payments_config",
            label: "Card payments",
            status: "warn",
            detail: "Stripe is not configured. Buyers can only pay by ACH/wire, which you must record by hand.",
            fix: "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to take card payments.",
          },
  );

  checks.push(
    has("CRON_SECRET")
      ? { key: "cron_config", label: "Scheduled jobs", status: "ok", detail: "CRON_SECRET is set." }
      : {
          key: "cron_config",
          label: "Scheduled jobs",
          status: prod ? "fail" : "warn",
          detail: "CRON_SECRET is not set, so the daily ops run (expiries, reminders, retries, digest) refuses to run.",
          fix: "Set CRON_SECRET in Vercel; Vercel Cron sends it automatically.",
        },
  );

  checks.push(
    has("APP_BASE_URL")
      ? { key: "base_url", label: "Link base URL", status: "ok", detail: `Links in emails point to ${env.APP_BASE_URL}.` }
      : {
          key: "base_url",
          label: "Link base URL",
          status: prod ? "fail" : "warn",
          detail: "APP_BASE_URL is not set, so links in emails point to localhost.",
          fix: "Set APP_BASE_URL=https://app.fanzia.io.",
        },
  );
  return checks;
}

/** Pure heartbeat evaluation. */
export function heartbeatCheck(lastRunIso: string | null, now: Date): HealthCheck {
  if (!lastRunIso) {
    return {
      key: "ops_heartbeat",
      label: "Daily ops run",
      status: "warn",
      detail: "The daily ops run has never reported in.",
      fix: "Confirm CRON_SECRET is set and the cron jobs appear under Vercel → Settings → Cron Jobs.",
    };
  }
  const last = new Date(lastRunIso);
  const ageH = (now.getTime() - last.getTime()) / HOUR;
  if (!Number.isFinite(ageH) || ageH > HEARTBEAT_MAX_AGE_HOURS) {
    return {
      key: "ops_heartbeat",
      label: "Daily ops run",
      status: "fail",
      detail: `Last run ${Number.isFinite(ageH) ? `${Math.round(ageH)} hours ago` : "unknown"}. Expiries, reminders, email retries and the digest are not happening.`,
      fix: "Check Vercel → Deployments → Functions logs for /api/cron/ops-sweep.",
    };
  }
  return { key: "ops_heartbeat", label: "Daily ops run", status: "ok", detail: `Last run ${Math.max(0, Math.round(ageH))}h ago.` };
}

async function migrationCheck(db: AnyDb): Promise<HealthCheck> {
  const expected = (journal as { entries: unknown[] }).entries.length;
  try {
    const res = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as {
      rows: { n: number }[];
    };
    const applied = Number(res.rows[0]?.n ?? 0);
    if (applied >= expected) {
      return { key: "migrations", label: "Database schema", status: "ok", detail: `${applied} of ${expected} migrations applied.` };
    }
    return {
      key: "migrations",
      label: "Database schema",
      status: "fail",
      detail: `${applied} of ${expected} migrations applied. The code expects tables or columns the database doesn't have yet.`,
      fix: "Redeploy production (migrations run during the build), or run `npm run db:deploy` with the production DATABASE_URL.",
    };
  } catch {
    return {
      key: "migrations",
      label: "Database schema",
      status: "warn",
      detail: "Could not read the migration history table.",
      fix: "Run `npm run db:deploy` against this database.",
    };
  }
}

/**
 * Everything that can silently go wrong, checked in one place. Powers the
 * System status page, the Today page banner, the weekly digest, and the
 * public uptime endpoint. Each check is isolated: one failing query never
 * hides the others.
 */
export async function runHealthChecks(db: AnyDb, now: Date = new Date(), env: Env = process.env): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    checks.push({ key: "database", label: "Database", status: "ok", detail: "Reachable." });
  } catch (err) {
    checks.push({
      key: "database",
      label: "Database",
      status: "fail",
      detail: `Unreachable: ${(err as Error).message.slice(0, 160)}`,
      fix: "Check the Neon dashboard for an outage or a paused/suspended project.",
    });
  }

  if (dbOk) {
    checks.push(await migrationCheck(db));

    const guarded = async (key: string, label: string, fn: () => Promise<HealthCheck>) => {
      try {
        checks.push(await fn());
      } catch (err) {
        checks.push({ key, label, status: "warn", detail: `Check failed: ${(err as Error).message.slice(0, 120)}` });
      }
    };

    await guarded("ops_heartbeat", "Daily ops run", async () =>
      heartbeatCheck(await getSetting<string | null>(OPS_SWEEP_HEARTBEAT_KEY, null, db), now),
    );

    await guarded("email_outbox", "Email delivery", async () => {
      const [pending] = await db.select({ n: count() }).from(emailOutbox).where(eq(emailOutbox.status, "pending"));
      const [dead] = await db
        .select({ n: count() })
        .from(emailOutbox)
        .where(and(eq(emailOutbox.status, "dead"), gte(emailOutbox.createdAt, new Date(now.getTime() - 7 * 24 * HOUR))));
      const p = pending?.n ?? 0;
      const d = dead?.n ?? 0;
      if (d > 0)
        return {
          key: "email_outbox",
          label: "Email delivery",
          status: "fail",
          detail: `${d} email(s) permanently failed this week; ${p} waiting to retry.`,
          fix: "Check the Resend dashboard (domain verification, sending limits).",
        };
      if (p > 0)
        return { key: "email_outbox", label: "Email delivery", status: "warn", detail: `${p} email(s) failed once and will be retried.` };
      return { key: "email_outbox", label: "Email delivery", status: "ok", detail: "No failed emails." };
    });

    await guarded("payment_failures", "Card payments (7 days)", async () => {
      const [failed] = await db
        .select({ n: count() })
        .from(notification)
        .where(
          and(
            inArray(notification.type, ["payment_failed", "payment_disputed"]),
            gte(notification.createdAt, new Date(now.getTime() - 7 * 24 * HOUR)),
          ),
        );
      const n = failed?.n ?? 0;
      return n > 0
        ? { key: "payment_failures", label: "Card payments (7 days)", status: "warn", detail: `${n} failed or disputed card payment(s) this week.` }
        : { key: "payment_failures", label: "Card payments (7 days)", status: "ok", detail: "No failures or disputes." };
    });

    await guarded("refunds", "Refunds owed", async () => {
      const rows = await db.select().from(refundDue).where(inArray(refundDue.status, ["pending", "failed"]));
      const overdue = rows.filter((r) => now.getTime() - r.createdAt.getTime() > 3 * 24 * HOUR);
      const total = rows.reduce((s, r) => s + r.amountMinor, 0);
      if (rows.length === 0) return { key: "refunds", label: "Refunds owed", status: "ok", detail: "None." };
      return {
        key: "refunds",
        label: "Refunds owed",
        status: overdue.length > 0 ? "fail" : "warn",
        detail: `${rows.length} refund(s) owed to buyers, $${(total / 100).toFixed(2)} total${overdue.length ? `; ${overdue.length} older than 3 days` : ""}.`,
        fix: "Pay them back and mark them refunded on the Today page.",
      };
    });

    await guarded("expiring_offers", "Orders about to expire", async () => {
      const soon = await db
        .select({ n: count() })
        .from(orderRequest)
        .where(and(eq(orderRequest.status, "submitted"), lte(orderRequest.expiresAt, new Date(now.getTime() + 12 * HOUR))));
      const n = soon[0]?.n ?? 0;
      return n > 0
        ? {
            key: "expiring_offers",
            label: "Orders about to expire",
            status: "warn",
            detail: `${n} order request(s) expire within 12 hours without a decision.`,
            fix: "Approve or decline them on the Today page, or raise the auto-approve limit in Settings.",
          }
        : { key: "expiring_offers", label: "Orders about to expire", status: "ok", detail: "None." };
    });

    await guarded("holds", "Accounts on hold", async () => {
      const [held] = await db.select({ n: count() }).from(account).where(isNotNull(account.orderingHoldReason));
      const n = held?.n ?? 0;
      return n > 0
        ? { key: "holds", label: "Accounts on hold", status: "warn", detail: `${n} account(s) blocked from ordering (disputes or manual holds).` }
        : { key: "holds", label: "Accounts on hold", status: "ok", detail: "None." };
    });

    await guarded("ordering", "Ordering", async () => {
      const config = await loadConfig(db);
      return config.ordering_paused
        ? { key: "ordering", label: "Ordering", status: "warn", detail: "Ordering is paused (Settings). Buyers cannot submit.", fix: "Unpause in Settings when ready." }
        : { key: "ordering", label: "Ordering", status: "ok", detail: "Open." };
    });
  }

  checks.push(...configChecks(env));

  const status: CheckStatus = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { ok: status !== "fail", status, checkedAt: now.toISOString(), checks };
}

/**
 * The narrow signal an external uptime monitor needs: can the app serve
 * requests and is the daily job alive. No details leave the building.
 * Strict on purpose: a heartbeat that has NEVER been recorded is red too,
 * so "the cron was never set up" can't hide behind a green monitor. After
 * a fresh deploy, run the cron once from Vercel → Cron Jobs → Run.
 */
export async function publicHealth(db: AnyDb, now: Date = new Date()): Promise<{ ok: boolean }> {
  try {
    await db.execute(sql`select 1`);
    const hb = heartbeatCheck(await getSetting<string | null>(OPS_SWEEP_HEARTBEAT_KEY, null, db), now);
    return { ok: hb.status === "ok" };
  } catch {
    return { ok: false };
  }
}
