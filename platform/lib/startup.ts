import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bootstrapCurrencies, bootstrapOwners, bootstrapTerms, parseBootstrapOwnerEmails } from "./bootstrap";

/**
 * Advisory lock key for the migration step, so concurrent server instances
 * (Vercel can boot several at once after a deploy) serialize instead of
 * racing on the migration journal. Arbitrary but fixed.
 */
const MIGRATION_LOCK_KEY = "4829471029384756102";

/**
 * Deploy-time tasks, run by `db/deploy.ts` as part of `npm run build`
 * (see package.json), never on the request path:
 *  1. Apply pending Drizzle migrations (advisory-locked).
 *  2. Provision owner accounts listed in BOOTSTRAP_OWNER_EMAILS.
 *  3. Publish policy versions, ensure currency rows.
 *
 * Throws on failure so a broken migration FAILS THE DEPLOY instead of
 * shipping code against a stale schema. Previously this ran inside the
 * root layout on every cold start, swallowed errors ("continuing without
 * it"), forced every page dynamic, and added migration latency to the
 * first request of every serverless instance.
 */
export async function runDeployTasks(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("[deploy] DATABASE_URL is unset; cannot migrate.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const lockClient = await pool.connect();
    try {
      await lockClient.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
      try {
        const migrationsFolder = path.join(process.cwd(), "db", "migrations");
        await migrate(drizzle(pool), { migrationsFolder });
        console.log("[deploy] database migrations are up to date");
      } finally {
        await lockClient.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
      }
    } finally {
      lockClient.release();
    }

    const ownerEmails = parseBootstrapOwnerEmails(process.env.BOOTSTRAP_OWNER_EMAILS);
    if (ownerEmails.length > 0) {
      const created = await bootstrapOwners(ownerEmails);
      if (created.length > 0) console.log(`[deploy] bootstrapped owner accounts: ${created.join(", ")}`);
    }

    // Currencies first: pricing depends on them; policies are independent.
    const currencies = await bootstrapCurrencies();
    if (currencies.length > 0) console.log(`[deploy] ensured currencies: ${currencies.join(", ")}`);

    const published = await bootstrapTerms();
    if (published.length > 0) console.log(`[deploy] published terms: ${published.join(", ")}`);
  } finally {
    await pool.end();
  }
}
