import { NextResponse } from "next/server";
import { areApplicationsOpen } from "@/lib/applications/portal";

/**
 * Public, read-only: lets the marketing site show "Apply" vs "Join the
 * waitlist" without hardcoding the portal state in two places. Before this
 * existed, the marketing site kept sending traffic to a closed /apply page.
 * Fails closed (open: false) if the database is unreachable.
 */
export async function GET() {
  let open = false;
  try {
    open = await areApplicationsOpen();
  } catch {
    open = false;
  }
  return NextResponse.json(
    { applicationsOpen: open },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
