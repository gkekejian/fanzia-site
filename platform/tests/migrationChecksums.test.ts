import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
// @ts-expect-error plain .mjs helper shared with the CLI
import { currentChecksums, readLock } from "../scripts/migration-checksums.mjs";

/**
 * Shipped migrations are immutable: production records them as applied and
 * never re-runs them, so an edited file silently diverges from production.
 * Change the schema with a new migration, then `npm run db:checksums`.
 */
describe("migration files", () => {
  const lock: Record<string, string> = readLock();
  const now: Record<string, string> = currentChecksums();

  it("never change after they're recorded", () => {
    const edited = Object.keys(lock).filter((f) => now[f] !== lock[f]);
    expect(edited, "Restore these migrations and add a new one instead").toEqual([]);
  });

  it("are all recorded (run `npm run db:checksums` after adding one)", () => {
    expect(Object.keys(now).filter((f) => !lock[f])).toEqual([]);
  });

  it("each have a journal entry", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = new Set(journal.entries.map((e) => e.tag));
    expect(Object.keys(now).map((f) => f.replace(/\.sql$/, "")).filter((t) => !tags.has(t))).toEqual([]);
  });
});
