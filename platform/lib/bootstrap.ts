import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable } from "@/db/schema";

/**
 * Parse the BOOTSTRAP_OWNER_EMAILS env var (comma-separated emails) into a
 * clean, deduplicated list. Anything without an "@" is dropped.
 */
export function parseBootstrapOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && e.includes("@")),
    ),
  ];
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const titled = local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return titled || email;
}

/**
 * Create any missing owner rows for the given emails. Idempotent — running it
 * again (or concurrently, thanks to the email unique constraint) never
 * duplicates or modifies existing users. It only ever INSERTs; it never
 * changes roles, names, or active flags on rows that already exist.
 *
 * This is the production-safe counterpart to db/seed.ts (which refuses to run
 * outside local/dev): it provisions the real, named owners and nothing else.
 * No fixtures, no test data, no ai_operator keys.
 */
export async function bootstrapOwners(emails: string[]): Promise<string[]> {
  const created: string[] = [];
  for (const email of emails) {
    const existing = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);
    if (existing.length > 0) continue;
    try {
      await db.insert(userTable).values({
        email,
        name: displayNameFromEmail(email),
        role: "owner",
        active: true,
      });
      created.push(email);
    } catch (err) {
      // Lost a concurrent-insert race (unique email constraint): the row
      // exists now, which is the outcome we wanted anyway.
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
    }
  }
  return created;
}
