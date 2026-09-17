import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { application, applicationDocument } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { sniffMime, ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/storage/mime";
import { putObject } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

const DOC_TYPES = new Set([
  "sellers_permit",
  "resale_certificate_cdtfa230",
  "resale_certificate_other_state",
  "channel_evidence",
  "other",
]);

/**
 * Auth here is the resume token, not a session — this endpoint is used by
 * an unauthenticated applicant partway through a resumable application
 * (build prompt §12: "resumable application, private uploads"). A wrong
 * token or application id combination returns 404, matching resume/route.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.headers.get("x-resume-token");
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tokenHash = hashToken(token);
  const rows = await db
    .select()
    .from(application)
    .where(
      and(
        eq(application.id, params.id),
        eq(application.resumeTokenHash, tokenHash),
        gt(application.resumeTokenExpiresAt, new Date()),
      ),
    )
    .limit(1);

  const app = rows[0];
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const docTypeRaw = formData?.get("docType");
  if (!(file instanceof File) || typeof docTypeRaw !== "string" || !DOC_TYPES.has(docTypeRaw)) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(buffer);
  if (!sniffed || !ALLOWED_MIME_TYPES.includes(sniffed)) {
    return NextResponse.json(
      { error: "Unsupported file type. Only PDF, JPEG, PNG, WEBP, and GIF are accepted." },
      { status: 400 },
    );
  }

  const { key } = await putObject(buffer);

  const [doc] = await db
    .insert(applicationDocument)
    .values({
      applicationId: app.id,
      docType: docTypeRaw as (typeof applicationDocument.$inferInsert)["docType"],
      storageKey: key,
      originalFilename: file.name.slice(0, 200),
      mimeVerified: sniffed,
      sizeBytes: buffer.length,
    })
    .returning();

  await recordAudit({
    actorType: "applicant",
    action: "application.document_uploaded",
    entityType: "application_document",
    entityId: doc!.id,
    after: { applicationId: app.id, docType: docTypeRaw, mimeVerified: sniffed },
  });

  return NextResponse.json({ ok: true, documentId: doc!.id });
}
