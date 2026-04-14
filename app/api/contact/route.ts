import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(40).optional().or(z.literal("")),
  message: z.string().min(1).max(5000),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form and try again." },
      { status: 400 },
    );
  }

  const { name, email, phone, message } = parsed.data;
  const to = process.env.CONTACT_TO_EMAIL || "contact@fanzia.io";
  const from = process.env.CONTACT_FROM_EMAIL || "no-reply@fanzia.io";
  const apiKey = process.env.RESEND_API_KEY;

  // Fallback: if Resend is not configured, log the submission so it's
  // visible in Vercel logs and return success. The UI also exposes a
  // mailto link so messages are never lost in practice.
  if (!apiKey) {
    console.log("[contact] (no RESEND_API_KEY set) submission:", {
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
