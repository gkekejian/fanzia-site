import { NextRequest, NextResponse } from "next/server";
import { consumeBuyerMagicLink } from "@/lib/auth/buyerMagicLink";
import { createBuyerSession, BUYER_SESSION_COOKIE } from "@/lib/auth/buyerSession";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";
import { magicLinkInterstitial, readPostedToken } from "@/lib/auth/linkInterstitial";

// 303 so the browser follows the POST with a GET.
function redirectTo(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url), 303);
}

/**
 * GET (the emailed link) only renders a confirm button; it never consumes
 * the token, so mail scanners that prefetch links can't burn it. The
 * button POSTs here. See lib/auth/linkInterstitial.ts.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirectTo(req, "/member/login?error=missing_token");
  return magicLinkInterstitial({ action: "/api/buyer/auth/magic-link/verify", token, heading: "Sign in to Fanzia Wholesale", button: "Sign in" });
}

export async function POST(req: NextRequest) {
  const token = await readPostedToken(req);
  if (!token) return redirectTo(req, "/member/login?error=missing_token");

  const result = await consumeBuyerMagicLink(token);
  if (!result) return redirectTo(req, "/member/login?error=invalid_or_expired");

  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");
  const { raw, expiresAt } = await createBuyerSession(result.accountContactId, result.accountId, { ip, userAgent });

  await recordAudit({
    actorType: "system",
    action: "buyer_auth.magic_link_verified",
    entityType: "account_contact",
    entityId: result.accountContactId,
    ip,
    userAgent,
  });

  const response = redirectTo(req, "/member/catalog");
  response.cookies.set(BUYER_SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
