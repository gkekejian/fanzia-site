import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { runAbandonedDraftSweep } from "@/lib/catalog/draftReminders";
import { sendRelationshipEmail, draftReminderBody } from "@/lib/email/relationship";
import { formatMoney } from "@/lib/format";

/**
 * Daily abandoned-draft reminder sweep. Runs on Vercel Cron (vercel.json),
 * which sends `Authorization: Bearer $CRON_SECRET` automatically when the
 * CRON_SECRET env var is set on the project. Without a matching secret the
 * route answers 401 and does nothing.
 *
 * For each abandoned draft (see lib/catalog/draftReminders.ts for the
 * rule): one plain, honest reminder email on the relationship stream —
 * never the transactional stream — then a log row so the same draft
 * version is never reminded twice. A failed send is NOT logged, so the
 * next run retries it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAbandonedDraftSweep(
    {
      sendEmail: (params) => sendRelationshipEmail(params),
      resumeUrl: `${process.env.APP_BASE_URL ?? "https://app.fanzia.io"}/member/draft-request`,
      formatMoney: (minor: number) => formatMoney(minor, "USD"),
      draftReminderBody,
    },
    db,
    new Date(),
  );

  return NextResponse.json(result);
}
