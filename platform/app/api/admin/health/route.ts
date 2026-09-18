import { NextRequest, NextResponse } from "next/server";
import { count, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { db } from "@/db/client";
import { application, account, orderRequest, invoice, catalogImport } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";

/**
 * Owner-only database health check (read-only). Reports:
 *  - DB connectivity (a trivial SELECT)
 *  - migration journal vs migration files on disk (drift detection:
 *    every journal entry should have a matching .sql file)
 *  - row counts for the key business tables
 * Surfaced in /admin/system-status.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Database health check");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  // 1) Connectivity: a trivial query proves the pool can reach Postgres.
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    dbError = (err as Error).message;
  }

  // 2) Migration journal vs files: every journal entry should have its
  // .sql file present, and vice versa. (Drift in the other direction —
  // migrations applied to the DB but since removed — is caught by the
  // startup runner; this is the cheap file-level check.)
  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  let journalTags: string[] = [];
  let fileTags: string[] = [];
  let migrationNote: string | null = null;
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    journalTags = journal.entries.map((e) => e.tag);
    fileTags = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""));
  } catch (err) {
    migrationNote = `Could not read migration files: ${(err as Error).message}`;
  }
  const missingFiles = journalTags.filter((t) => !fileTags.includes(t));
  const unjournaledFiles = fileTags.filter((t) => !journalTags.includes(t));
  const migrationsInSync = migrationNote === null && missingFiles.length === 0 && unjournaledFiles.length === 0;

  // 3) Key table counts (read-only COUNT(*)).
  const tableCounts: Record<string, number | string> = {};
  if (dbOk) {
    const tables = {
      application,
      account,
      orderRequest,
      invoice,
      catalogImport,
    } as const;
    for (const [name, table] of Object.entries(tables)) {
      try {
        const [row] = await db.select({ n: count() }).from(table);
        tableCounts[name] = row?.n ?? 0;
      } catch (err) {
        tableCounts[name] = `error: ${(err as Error).message}`;
      }
    }
  }

  const ok = dbOk && migrationsInSync;
  return NextResponse.json({
    ok,
    checkedAt: new Date().toISOString(),
    database: { reachable: dbOk, error: dbError },
    migrations: {
      inSync: migrationsInSync,
      journalEntries: journalTags.length,
      filesOnDisk: fileTags.length,
      missingFiles,
      unjournaledFiles,
      note: migrationNote,
    },
    tableCounts,
  });
}
