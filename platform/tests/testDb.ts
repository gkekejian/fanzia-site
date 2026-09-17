import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import * as schema from "@/db/schema";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * In-process Postgres (WASM) for the automated test suite, so tests don't
 * depend on network access to a package mirror or a running Docker daemon
 * — both were unavailable in the sandbox this Phase 1 build ran in. Real
 * local/dev/CI use docker-compose's real Postgres (docs/migration-plan.md);
 * this is a test-only substitute that runs the exact same committed SQL
 * migration files, so a passing test here means the real migrations work.
 */
export async function createTestDb() {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = sql.split("--> statement-breakpoint");
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  const db = drizzle(client, { schema });
  return { db, client };
}
