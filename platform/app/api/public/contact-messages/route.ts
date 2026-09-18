import { NextRequest, NextResponse } from "next/server";
import { ingestContactMessage, ingestSchema, IngestAuthError } from "@/lib/contactMessages";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Public ingestion endpoint for the marketing site's contact form. The
 * marketing site calls this server-side with the shared CONTACT_INGEST_SECRET
 * — the secret never reaches the browser. Light per-IP rate limiting here is
 * defense in depth; the marketing form does its own spam checks first.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`contact-ingest:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fill in all required fields with valid values." }, { status: 400 });
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
