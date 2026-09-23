import { NextRequest, NextResponse } from "next/server";
import { ingestContactMessage, ingestSchema, IngestAuthError } from "@/lib/contactMessages";
import { clientIp, rateLimited, PUBLIC_WRITE_LIMITS } from "@/lib/rateLimit";
import { verifyTurnstile, turnstileFailureBody } from "@/lib/turnstile";

/**
 * Public ingestion endpoint for the marketing site's contact form. The
 * marketing site calls this server-side with the shared CONTACT_INGEST_SECRET
 * — the secret never reaches the browser. Light per-IP rate limiting here is
 * defense in depth; the marketing form does its own spam checks first.
 *
 * Turnstile: the marketing site may forward its widget's client token as
 * `turnstileToken`. When a token is present it is verified against
 * Cloudflare; when absent the request is allowed (fail-open) so the form
 * keeps working before the marketing site adds the widget.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const limited = await rateLimited(`contact-ingest:${ip}`, PUBLIC_WRITE_LIMITS.contactIngest);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fill in all required fields with valid values." }, { status: 400 });
  }

  const turnstileToken = typeof json.turnstileToken === "string" ? json.turnstileToken : null;
  if (turnstileToken) {
    const turnstile = await verifyTurnstile(turnstileToken, ip);
    if (!turnstile.ok) {
      return NextResponse.json(turnstileFailureBody(), { status: 403 });
    }
  }

  try {
    const row = await ingestContactMessage(parsed.data, req.headers.get("x-ingest-secret"));
    return NextResponse.json({ ok: true, id: row!.id });
  } catch (err) {
    if (err instanceof IngestAuthError) {
      console.error("[contact-ingest] auth failure from ip:", ip);
      return NextResponse.json({ error: "Not configured." }, { status: 503 });
    }
    console.error("[contact-ingest] failed:", err);
    return NextResponse.json({ error: "Could not save your message. Please try again." }, { status: 500 });
  }
}
