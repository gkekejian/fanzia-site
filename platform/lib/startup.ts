import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bootstrapOwners, parseBootstrapOwnerEmails } from "./bootstrap";

/**
 * Advisory lock key for the migration step, so concurrent server instances
 * (Vercel can boot several at once after a deploy) serialize instead of
 * racing on the migration journal. Arbitrary but fixed.
 */
const MIGRATION_LOCK_KEY = "4829471029384756102";

/**
 * Runs once per server process (see ensureStartupTasks below):
 *  1. Apply any pending Drizzle migrations (versioned, append-only — the same
 *     scripts `npm run db:migrate` runs locally).
 *  2. Provision real owner accounts listed in BOOTSTRAP_OWNER_EMAILS.
 *
 * Both steps are idempotent. Nothing is ever seeded: no fixtures, no test
 * data, no placeholder accounts (db/seed.ts stays local-only).
 *
 * Never throws: a failed boot task is logged, not fatal. Crashing the
 * instance into a restart loop would be worse than serving with a stale
 * schema, and the error is visible in the function logs.
 */
export async function runStartupTasks(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[startup] DATABASE_URL is unset; skipping migrations and owner bootstrap.");
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const lockClient = await pool.connect();
  try {
    await lockClient.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      const migrationsFolder = path.join(process.cwd(), "db", "migrations");
      // Visibility: on serverless the migrations folder must be bundled
      // (see outputFileTracingIncludes in next.config.js). Log what we find
      // so a missing folder is obvious in the function logs instead of a
      // bare ENOENT from the migrator.
      let migrationFiles: string[];
      try {
        migrationFiles = (await import("fs")).readdirSync(migrationsFolder);
      } catch {
        migrationFiles = [];
      }
      console.log(
        `[startup] migrations folder: ${migrationsFolder} (${migrationFiles.length} files)`
      );
      await migrate(drizzle(pool), { migrationsFolder });
      console.log("[startup] database migrations are up to date");
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }

    const ownerEmails = parseBootstrapOwnerEmails(process.env.BOOTSTRAP_OWNER_EMAILS);
    if (ownerEmails.length > 0) {
      const created = await bootstrapOwners(ownerEmails);
      if (created.length > 0) {
        console.log(`[startup] bootstrapped owner accounts: ${created.join(", ")}`);
      }
    }
  } catch (err) {
    console.error("[startup] startup task failed (see above); continuing without it.", err);
  } finally {
    lockClient.release();
    await pool.end();
  }
}

let started = false;

/**
 * Fire-and-forget entry point, called from the root layout. Runs the startup
 * tasks exactly once per server process; skipped during `next build`
 * prerendering and when there is nothing to do. Safe to call on every render.
 */
export function ensureStartupTasks(): void {
  if (started) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  started = true;
  runStartupTasks().catch((err) => {
    console.error("[startup] ensureStartupTasks failed:", err);
  });
}
