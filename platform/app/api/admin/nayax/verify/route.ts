import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { isNayaxConfigured, listMachines, NayaxNotConfigured, NayaxApiError } from "@/lib/nayax/client";

/**
 * Owner-only read-only connection check. Hits GET /v1/machines with the
 * configured token and returns counts + names. NEVER returns the token
 * itself — it lives only in process.env.
 */
export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Nayax connection check");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  if (!isNayaxConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error:
        "NAYAX_API_TOKEN is not set. Mint a user token in Nayax Core " +
        "(Account Settings → Security and Login → User Tokens) and set it as the NAYAX_API_TOKEN env var.",
    });
  }

  try {
    const machines = await listMachines();
    return NextResponse.json({
      ok: true,
      configured: true,
      machineCount: machines.length,
      machineNames: machines.map((m) => ({ machineId: m.machineId, name: m.name, site: m.site })),
    });
  } catch (err) {
    if (err instanceof NayaxNotConfigured) {
      return NextResponse.json({ ok: false, configured: false, error: err.message });
    }
    const status = err instanceof NayaxApiError && err.status >= 400 && err.status < 500 ? err.status : 502;
    return NextResponse.json({ ok: false, configured: true, error: (err as Error).message }, { status });
  }
}
