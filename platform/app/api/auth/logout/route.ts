import { NextRequest, NextResponse } from "next/server";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (raw) await revokeSession(raw);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
