// Guards against editing a migration after it has shipped: production
// databases record each migration as applied and never re-run it, so an
// edited file silently diverges from what production actually has.
//
//   node scripts/migration-checksums.mjs          check (used by the test suite)
//   node scripts/migration-checksums.mjs --write  record new migrations
//
// --write only ADDS entries for new files; it never rewrites an existing
// checksum. Fix a shipped migration with a new migration instead.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "db", "migrations");
const lockPath = path.join(dir, "meta", "checksums.json");

export function currentChecksums() {
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    out[f] = createHash("sha256").update(readFileSync(path.join(dir, f))).digest("hex");
  }
  return out;
}

export function readLock() {
  return existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const lock = readLock();
  const now = currentChecksums();
  const changed = Object.keys(lock).filter((f) => now[f] && now[f] !== lock[f]);
  const removed = Object.keys(lock).filter((f) => !now[f]);
  if (changed.length || removed.length) {
    console.error(`Shipped migrations were edited or removed: ${[...changed, ...removed].join(", ")}. Restore them and add a new migration instead.`);
    process.exit(1);
  }
  const added = Object.keys(now).filter((f) => !lock[f]);
  if (process.argv.includes("--write")) {
    for (const f of added) lock[f] = now[f];
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    console.log(added.length ? `Recorded: ${added.join(", ")}` : "Nothing new to record.");
  } else if (added.length) {
    console.error(`New migrations not recorded yet: ${added.join(", ")}. Run: npm run db:checksums`);
    process.exit(1);
  } else {
    console.log("Migration checksums OK.");
  }
}
