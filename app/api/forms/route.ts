import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Shared handler for every request/apply/quote form on the site
// (wholesale application, catalog access, wholesale order, parts quote).
// No database, no auth: each submission is validated, spam-checked, and
// emailed via Resend (or logged if Resend isn't configured). File uploads
// (resale certificate, business license, location photo) are attached to
// the email as-is; nothing is persisted server-side.

const KINDS = ["wholesale", "catalog-access", "order", "parts-quote"] as const;
type Kind = (typeof KINDS)[number];

const REQUIRED_FIELDS: Record<Kind, string[]> = {
  wholesale: [
    "legalName",
    "businessType",
    "yearsInOperation",
    "numLocations",
    "address",
    "city",
    "state",
    "zip",
    "ein",
    "resaleCertNumber",
    "contactName",
    "contactTitle",
    "contactEmail",
    "contactPhone",
    "volume",
  ],
  "catalog-access": [
    "businessName",
    "contactName",
    "email",
    "phone",
    "businessType",
    "resaleCertNumber",
  ],
  order: ["accountEmail", "fulfillment", "lineItems"],
  "parts-quote": ["businessName", "contactName", "email", "phone"],
};

const REQUIRED_FILES: Partial<Record<Kind, string[]>> = {
  wholesale: ["file_resaleCert"],
};

const KIND_LABEL: Record<Kind, string> = {
  wholesale: "Wholesale Application",
  "catalog-access": "Catalog Access Request",
  order: "Wholesale Order Request",
  "parts-quote": "Supply Parts Quote Request",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.slice(0, 5000);
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const kind = formData.get("kind");
  if (typeof kind !== "string" || !KINDS.includes(kind as Kind)) {
    return NextResponse.json({ error: "Invalid form type." }, { status: 400 });
  }
  const k = kind as Kind;

  // Honeypot: any value means a bot filled it in. Report success so the
  // bot can't tell it was dropped.
  const honeypot = formData.get("website");
  if (typeof honeypot === "string" && honeypot.length > 0) {
    console.warn("[forms] honeypot triggered from ip:", ip);
    return NextResponse.json({ ok: true, delivery: "dropped" });
  }

  const startedAt = Number(formData.get("_start"));
  if (Number.isFinite(startedAt) && Date.now() - startedAt < 1500) {
    console.warn("[forms] timing check failed from ip:", ip);
    return NextResponse.json({ ok: true, delivery: "dropped" });
  }

  // Collect text fields (repeated keys, e.g. multi-select checkboxes,
  // become arrays) and files separately.
  const fields: Record<string, string | string[]> = {};
  const files: { field: string; file: File }[] = [];

  for (const [key, value] of formData.entries()) {
    if (key === "kind" || key === "website" || key === "_start") continue;
    if (value instanceof File) {
      if (value.size > 0) files.push({ field: key, file: value });
      continue;
    }
    const clean = stripControls(value);
    if (fields[key] === undefined) {
      fields[key] = clean;
    } else if (Array.isArray(fields[key])) {
      (fields[key] as string[]).push(clean);
    } else {
      fields[key] = [fields[key] as string, clean];
    }
  }

  const missing = REQUIRED_FIELDS[k].filter((f) => {
    const v = fields[f];
    return v === undefined || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Please fill in all required fields." },
      { status: 400 },
    );
  }

  const requiredFiles = REQUIRED_FILES[k] || [];
  for (const fieldName of requiredFiles) {
    if (!files.some((f) => f.field === fieldName)) {
      return NextResponse.json(
        { error: "Please attach all required files." },
        { status: 400 },
      );
    }
  }

  for (const { file } of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `${file.name} is larger than the 10MB limit.` },
        { status: 400 },
      );
    }
  }

  const replyTo =
    (typeof fields.contactEmail === "string" && fields.contactEmail) ||
    (typeof fields.email === "string" && fields.email) ||
    (typeof fields.accountEmail === "string" && fields.accountEmail) ||
    undefined;

  const summaryLines = Object.entries(fields).map(([key, value]) => {
    const v = Array.isArray(value) ? value.join(", ") : value;
    return `${key}: ${v}`;
  });

  const to = process.env.CONTACT_TO_EMAIL || "george@fanzia.io";
  const from = process.env.CONTACT_FROM_EMAIL || "no-reply@fanzia.io";
  const apiKey = process.env.RESEND_API_KEY;
  const subject = `${KIND_LABEL[k]} — ${fields.legalName || fields.businessName || fields.accountEmail || "New submission"}`;
  const text = summaryLines.join("\n");

  if (!apiKey) {
    console.log(`[forms] (no RESEND_API_KEY set) ${k} submission:`, {
      ip,
      fields,
      files: files.map((f) => ({ field: f.field, name: f.file.name, size: f.file.size })),
    });
    return NextResponse.json({ ok: true, delivery: "logged" });
  }

  try {
    const attachments = await Promise.all(
      files.map(async ({ file }) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()),
      })),
    );

    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      replyTo,
      subject,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (result.error) {
      console.error("[forms] resend error:", result.error);
      return NextResponse.json(
        { error: "Could not send. Please email contact@fanzia.io directly." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, delivery: "email" });
  } catch (err) {
    console.error("[forms] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not send. Please email contact@fanzia.io directly." },
      { status: 500 },
    );
  }
}
