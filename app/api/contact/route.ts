import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

// Body schema. `website` is a honeypot: legitimate visitors won't see or
// fill it; bots crawling the form will. Any non-empty value short-circuits
// as spam without leaking that it was detected.
const schema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  message: z.string().trim().min(1).max(5000),
  website: z.string().max(0).optional().or(z.literal("")),
  _start: z.number().optional(),
});

// In-memory rate limit: at most 5 submissions per IP per 10 min window.
// Sufficient for low-volume marketing traffic; swap for Vercel KV /
// Upstash if this ever needs to span instances.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= MAX_REQUESTS) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { ok: true };
}

function stripControls(s: string) {
  // Remove control chars that shouldn't appear in name/email/phone/message.
  return s.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 5000);
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form and try again." },
      { status: 400 },
    );
  }

  // Honeypot: if the hidden `website` field has any value, it's a bot.
  // Return a success response so the bot can't tell it was blocked.
  if (parsed.data.website && parsed.data.website.length > 0) {
    console.warn("[contact] honeypot triggered from ip:", ip);
    return NextResponse.json({ ok: true, delivery: "dropped" });
  }

  // Timing check: any real human takes >1.5s to fill the form. If `_start`
  // is set and the submission happens faster than that, treat as spam.
  if (
    typeof parsed.data._start === "number" &&
    Date.now() - parsed.data._start < 1500
  ) {
    console.warn("[contact] timing check failed from ip:", ip);
    return NextResponse.json({ ok: true, delivery: "dropped" });
  }

  const name = stripControls(parsed.data.name);
  const email = stripControls(parsed.data.email);
  const phone = stripControls(parsed.data.phone || "");
  const message = stripControls(parsed.data.message);

  const to = process.env.CONTACT_TO_EMAIL || "george@fanzia.io";
  const from = process.env.CONTACT_FROM_EMAIL || "no-reply@fanzia.io";
  const apiKey = process.env.RESEND_API_KEY;

  // Fallback: if Resend is not configured, log the submission so it's
  // visible in Vercel logs and return success.
  if (!apiKey) {
    console.log("[contact] (no RESEND_API_KEY set) submission:", {
      ip,
      name,
      email,
      phone,
      message,
    });
    return NextResponse.json({ ok: true, delivery: "logged" });
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      replyTo: email,
      subject: `New Fanzia inquiry from ${name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || "(none)"}`,
        `IP: ${ip}`,
        "",
        message,
      ].join("\n"),
    });

    if (result.error) {
      console.error("[contact] resend error:", result.error);
      return NextResponse.json(
        { error: "Could not send. Please email contact@fanzia.io directly." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, delivery: "email" });
  } catch (err) {
    console.error("[contact] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not send. Please email contact@fanzia.io directly." },
      { status: 500 },
    );
  }
}
