import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { application, applicationDocument, termsAcceptance } from "@/db/schema";
import { applicationSchema, aiDisclosureLabel } from "@/lib/validation/application";
import { scoreApplication } from "@/lib/applications/triage";
import { buildApplicationConfirmationEmail } from "@/lib/applications/confirmationEmail";
import { generateToken, hashToken } from "@/lib/crypto";
import { sendNotificationEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { clientIp, rateLimited, PUBLIC_WRITE_LIMITS } from "@/lib/rateLimit";
import { verifyTurnstile, turnstileFailureBody } from "@/lib/turnstile";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { findDuplicateApplication } from "@/lib/applications/dedupe";
import { buildBusinessSummary, formatSummaryEmail, runApplicationChecks } from "@/lib/applications/summary";
import { getLatestPublishedTermsVersion } from "@/lib/terms";
import { termsClickwrapLabel } from "@/lib/policies/clickwrap";
import { notifyOwnersEvent } from "@/lib/notifications";
import { sniffMime, ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/storage/mime";
import { putObject, deleteObject } from "@/lib/storage";

const RESALE_CERT_FILE_FIELD = "resaleCertificate";

/**
 * The application form posts multipart/form-data because the resale
 * certificate copy is uploaded at submit time (owner policy 2026-09-20:
 * no submissions without the certificate on file). JSON is still
 * accepted for programmatic callers; without a file attached the request
 * is rejected the same way — the certificate is required in both shapes.
 */
async function parseApplicationBody(req: NextRequest): Promise<{
  fields: Record<string, unknown>;
  file: File | null;
}> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData().catch(() => null);
    if (!formData) return { fields: {}, file: null };
    const fields: Record<string, unknown> = {};
    const multi: Record<string, unknown[]> = {};
    for (const [key, value] of formData.entries()) {
      if (key === RESALE_CERT_FILE_FIELD) continue;
      if (value instanceof File) continue;
      (multi[key] ??= []).push(value);
    }
    for (const [key, values] of Object.entries(multi)) {
      fields[key] = values.length === 1 ? values[0] : values;
    }
    const rawFile = formData.get(RESALE_CERT_FILE_FIELD);
    return { fields, file: rawFile instanceof File ? rawFile : null };
  }
  const json = await req.json().catch(() => null);
  return { fields: (json ?? {}) as Record<string, unknown>, file: null };
}

function invalidFileResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const limited = rateLimited(`apply:${ip}`, PUBLIC_WRITE_LIMITS.applicationSubmit);
  if (limited) return limited;

  const { fields, file } = await parseApplicationBody(req);

  // Bot check (Cloudflare Turnstile). Fail-open when the secret key is not
  // configured; enforced once the owner provisions the keys.
  const turnstile = await verifyTurnstile(
    typeof fields.turnstileToken === "string" ? fields.turnstileToken : null,
    ip,
  );
  if (!turnstile.ok) {
    return NextResponse.json(turnstileFailureBody(), { status: 403 });
  }

  const parsed = applicationSchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Honeypot: a bot fills every field, including ones humans never see.
  if (input.website) {
    return NextResponse.json({ ok: true }); // pretend success, no record created
  }

  // The resale certificate copy is mandatory at submit time — this is the
  // document Fanzia must keep on file to sell tax-free. Validated before
  // anything is written so a bad upload never creates a half-application.
  if (!file || file.size === 0) {
    return invalidFileResponse("A copy of your resale certificate is required. Upload a PDF or a clear photo.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return invalidFileResponse("The resale certificate file is too large (max 15 MB).");
  }
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(fileBuffer);
  if (!sniffed || !ALLOWED_MIME_TYPES.includes(sniffed)) {
    return invalidFileResponse("Unsupported file type. Upload your resale certificate as a PDF, JPEG, PNG, WEBP, or GIF.");
  }

  const termsVersion = await getLatestPublishedTermsVersion("terms_of_sale");
  if (!termsVersion) {
    return NextResponse.json({ error: "Terms of Sale are not currently available. Try again shortly." }, { status: 503 });
  }

  // Duplicate guard: a business name or email that already has a live
  // application in the review queue can't create a second one — the
  // applicant gets their status link re-emailed instead.
  const duplicate = await findDuplicateApplication(input.businessLegalName, input.contactEmail);
  if (duplicate) {
    const freshResumeToken = generateToken();
    const duplicateTtlHours = await getSetting<number>(SETTINGS_KEYS.resumeTokenTtlHours, 168);
    await db
      .update(application)
      .set({
        resumeTokenHash: hashToken(freshResumeToken),
        resumeTokenExpiresAt: new Date(Date.now() + duplicateTtlHours * 60 * 60 * 1000),
      })
      .where(eq(application.id, duplicate.id));
    const statusUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/apply/continue?token=${freshResumeToken}`;
    // Best-effort: the original application is untouched; a failed
    // re-send just means the applicant uses their earlier link.
    await sendNotificationEmail({
      to: duplicate.contactEmail,
      subject: "Your Fanzia wholesale application is still under review",
      text: `You already have a wholesale application under review for ${duplicate.businessLegalName} — no need to apply again.\n\nCheck its status or add documents any time at:\n\n${statusUrl}\n\nThis link is valid for ${duplicateTtlHours} hours.`,
    }, "application.duplicate_resend");
    await recordAudit({
      actorType: "applicant",
      action: "application.duplicate_rejected",
      entityType: "application",
      entityId: duplicate.id,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json(
      {
        error: `An application for ${duplicate.businessLegalName} is already under review. We've emailed a fresh status link to ${duplicate.contactEmail} — no need to apply again.`,
        duplicate: true,
      },
      { status: 409 },
    );
  }

  const { score, reasons } = scoreApplication(input);
  const rawResumeToken = generateToken();
  const ttlHours = await getSetting<number>(SETTINGS_KEYS.resumeTokenTtlHours, 168);
  const now = new Date();

  // Consistency: the certificate file is stored BEFORE the application
  // row is created. A storage failure therefore leaves no half-application
  // behind, and the database writes below run in a single transaction — if
  // any of them fail, the orphaned upload is cleaned up best-effort.
  let storageKey: string;
  try {
    ({ key: storageKey } = await putObject(fileBuffer));
  } catch (err) {
    console.error("[applications] certificate upload failed; no application created", err);
    return NextResponse.json(
      { error: "We couldn't save your resale certificate. Please try again." },
      { status: 500 },
    );
  }

  let created: typeof application.$inferSelect;
  let resaleDoc: typeof applicationDocument.$inferSelect;
  try {
    const result = await db.transaction(async (tx) => {
      const [app] = await tx
        .insert(application)
        .values({
          businessLegalName: input.businessLegalName,
          dba: input.dba || null,
          entityType: input.entityType,
          formationState: input.formationState,
          sosEntityNumber: input.sosEntityNumber || null,
          channelType: input.channelType,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 || null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          country: input.country,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          locationCount: input.locationCount,
          yearsInBusiness: input.yearsInBusiness ?? null,
          expectedMonthlyVolumeUsd: input.expectedMonthlyVolumeUsd,
          resaleCertNumber: input.resaleCertNumber,
          resaleCertState: input.resaleCertState,
          signatureName: input.signatureName,
          aiDisclosureAcceptedAt: now,
          aiDisclosureLanguage: aiDisclosureLabel(),
          channelEvidenceUrl: input.channelEvidenceUrl || null,
          sellersPermitNumber: input.sellersPermitNumber || null,
          productInterests: input.productInterests,
          onlinePresence: input.onlinePresence || null,
          resumeTokenHash: hashToken(rawResumeToken),
          resumeTokenExpiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
          triageScore: score,
          needsReviewReasons: reasons,
          status: "submitted",
          submittedAt: now,
        })
        .returning();

      // Store the resale certificate copy alongside the application. The doc
      // type reflects the issuing state (California's is the CDTFA-230); the
      // review screen renders it for the approver either way.
      const [doc] = await tx
        .insert(applicationDocument)
        .values({
          applicationId: app!.id,
          docType:
            input.resaleCertState === "CA" ? "resale_certificate_cdtfa230" : "resale_certificate_other_state",
          storageKey,
          originalFilename: file.name.slice(0, 200) || "resale-certificate",
          mimeVerified: sniffed,
          sizeBytes: fileBuffer.length,
        })
        .returning();

      await recordAudit(
        {
          actorType: "applicant",
          action: "application.document_uploaded",
          entityType: "application_document",
          entityId: doc!.id,
          after: { applicationId: app!.id, docType: doc!.docType, mimeVerified: sniffed },
        },
        tx,
      );

      // Berman-compliant clickwrap evidence, captured at the exact moment of
      // submission: the visible checkbox language, the immutable published
      // terms_version it links to, and the request's own IP/UA/page context
      // (build prompt §12, test gate #20).
      await tx.insert(termsAcceptance).values({
        applicationId: app!.id,
        termsVersionId: termsVersion.id,
        visibleLanguageSnapshot: termsClickwrapLabel(termsVersion.versionLabel),
        ip,
        userAgent: req.headers.get("user-agent") ?? "unknown",
        pageContext: "/apply",
      });

      await recordAudit(
        {
          actorType: "applicant",
          action: "application.submitted",
          entityType: "application",
          entityId: app!.id,
          ip,
          userAgent: req.headers.get("user-agent"),
        },
        tx,
      );

      return { app: app!, doc: doc! };
    });
    created = result.app;
    resaleDoc = result.doc;
  } catch (err) {
    await deleteObject(storageKey);
    console.error("[applications] submission failed; orphaned upload cleaned up", err);
    return NextResponse.json(
      { error: "Something went wrong saving your application. Please try again." },
      { status: 500 },
    );
  }

  await recordAudit({
    actorType: "applicant",
    action: "application.submitted",
    entityType: "application",
    entityId: created.id,
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  const resumeUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/apply/continue?token=${rawResumeToken}`;
  const confirmation = buildApplicationConfirmationEmail({
    businessLegalName: input.businessLegalName,
    channelEvidenceUrl: input.channelEvidenceUrl || null,
    onlinePresence: input.onlinePresence || null,
    ttlHours,
    resumeUrl,
    resaleCertReceived: true,
  });
  // Best-effort: the application is already saved; a failed confirmation
  // email must not 500 the submission (would cause duplicate applications).
  await sendNotificationEmail({
    to: input.contactEmail,
    subject: confirmation.subject,
    text: confirmation.text,
  }, "application.confirmation");

  const reviewUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/applications/${created.id}`;
  // Business summary + deterministic checks for the admin notification —
  // the automated version of the manual approve/decline brief. The resale
  // certificate document is passed in explicitly: it was uploaded with
  // this submission, so the checks can credit it.
  const docs = [
    {
      docType: resaleDoc.docType,
      originalFilename: resaleDoc.originalFilename,
    },
  ];
  const summary = buildBusinessSummary(created, docs);
  const checks = runApplicationChecks(created, docs);
  await notifyOwnersEvent({
    type: "application_submitted",
    title: `New wholesale application — ${input.businessLegalName}`,
    body:
      `${input.businessLegalName} (${input.contactEmail}) submitted a wholesale application.\n\n` +
      formatSummaryEmail(summary, checks, score, reasons) +
      `\n\nReview: ${reviewUrl}`,
    actorEmail: input.contactEmail,
    entityType: "application",
    entityId: created.id,
  });

  return NextResponse.json({ ok: true });
}
