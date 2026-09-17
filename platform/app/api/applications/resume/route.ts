import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { application, applicationDocument } from "@/db/schema";
import { hashToken } from "@/lib/crypto";

/**
 * A wrong or expired token returns 404, never 403 — build prompt test gate
 * #2 ("One buyer cannot access another buyer's ... return 404 for
 * cross-account object access, never 403") applies here even though there
 * is no login yet: the resume token IS the access credential for an
 * unauthenticated applicant, so the same non-disclosure rule applies.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tokenHash = hashToken(token);
  const rows = await db
    .select()
    .from(application)
    .where(and(eq(application.resumeTokenHash, tokenHash), gt(application.resumeTokenExpiresAt, new Date())))
    .limit(1);

  const app = rows[0];
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const documents = await db
    .select({
      id: applicationDocument.id,
      docType: applicationDocument.docType,
      originalFilename: applicationDocument.originalFilename,
      uploadedAt: applicationDocument.uploadedAt,
    })
    .from(applicationDocument)
    .where(eq(applicationDocument.applicationId, app.id));

  return NextResponse.json({
    id: app.id,
    status: app.status,
    businessLegalName: app.businessLegalName,
    submittedAt: app.submittedAt,
    documents,
  });
}
