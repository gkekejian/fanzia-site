import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth/magicLink";
import { sendTransactionalEmail } from "@/lib/email/send";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { recordAudit } from "@/lib/audit";

/**
 * Always returns the same 200 response whether or not the email belongs to
 * a known owner — never reveal which addresses are registered (build
 * prompt §2 non-disclosure principle, same rule test gate #2 applies to
 * cross-account object access).
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!(await checkRateLimit(`magic-link:${ip}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const email = typeof json?.email === "string" ? json.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  if (!(await checkRateLimit(`magic-link:${email}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const result = await createMagicLink(email);
  if (result) {
    const url = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/api/auth/magic-link/verify?token=${result.raw}`;
    await sendTransactionalEmail({
      to: email,
      subject: "Your Fanzia platform sign-in link",
      text: `Sign in to the Fanzia platform:\n\n${url}\n\nThis link expires in 15 minutes and can only be used once. If you did not request this, you can ignore this email.`,
    });
    await recordAudit({
      actorType: "system",
      action: "auth.magic_link_requested",
      entityType: "user",
      entityId: result.userId,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
  }

  return NextResponse.json({ ok: true, message: "If that email is registered, a sign-in link has been sent." });
}
