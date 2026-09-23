import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Lazily constructed on first use. The old version threw at IMPORT time
 * when DATABASE_URL was unset, which broke `next build` ("Failed to collect
 * page data") in CI and in any environment without database credentials,
 * even though no page needs the database at build time.
 */
let instance: NodePgDatabase<typeof schema> | null = null;

function getDb(): NodePgDatabase<typeof schema> {
  if (instance) return instance;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (see .env.example)");
  }
  // Serverless: keep per-instance pools small; use Neon's pooled
  // (-pooler) connection string in production.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  instance = drizzle(pool, { schema });
  return instance;
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export type Database = NodePgDatabase<typeof schema>;
