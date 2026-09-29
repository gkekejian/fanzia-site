import { NextResponse } from "next/server";
import { areApplicationsOpen } from "@/lib/applications/portal";
import { loadConfig } from "@/lib/config";

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
  // How buyers get product (Settings → Allocations), so the marketing
  // site's "How it works" matches the portal.
  let sellingMode = "self_serve";
  try {
    sellingMode = (await loadConfig()).selling_mode;
  } catch {
    sellingMode = "self_serve";
  }
  return NextResponse.json(
    { applicationsOpen: open, sellingMode },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
