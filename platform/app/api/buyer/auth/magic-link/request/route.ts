import { NextRequest, NextResponse } from "next/server";
import { createBuyerMagicLink } from "@/lib/auth/buyerMagicLink";
import { sendTransactionalEmail } from "@/lib/email/send";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

/** Same non-disclosure shape as the owner magic-link route (build prompt §2). */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!(await checkRateLimit(`buyer-magic-link:${ip}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const email = typeof json?.email === "string" ? json.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!(await checkRateLimit(`buyer-magic-link:${email}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const result = await createBuyerMagicLink(email);
  if (result) {
    const url = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/api/buyer/auth/magic-link/verify?token=${result.raw}`;
    await sendTransactionalEmail({
      to: email,
      subject: "Your Fanzia buyer sign-in link",
      text: `Sign in to your Fanzia wholesale account:\n\n${url}\n\nThis link expires shortly and can only be used once. If you did not request this, you can ignore this email.`,
    });
    await recordAudit({
      actorType: "system",
      action: "buyer_auth.magic_link_requested",
      entityType: "account_contact",
      entityId: result.accountContactId,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
  }

  return NextResponse.json({ ok: true, message: "If that email is on an approved account, a sign-in link has been sent." });
}
