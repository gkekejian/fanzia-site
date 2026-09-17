import { NextRequest, NextResponse } from "next/server";
import { revokeBuyerSession, BUYER_SESSION_COOKIE } from "@/lib/auth/buyerSession";

export async function POST(req: NextRequest) {
  const raw = req.cookies.get(BUYER_SESSION_COOKIE)?.value;
  if (raw) await revokeBuyerSession(raw);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(BUYER_SESSION_COOKIE);
  return response;
}
