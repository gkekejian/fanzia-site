import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { application, termsAcceptance } from "@/db/schema";
import { applicationSchema } from "@/lib/validation/application";
import { scoreApplication } from "@/lib/applications/triage";
import { generateToken, hashToken } from "@/lib/crypto";
import { sendNotificationEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { findDuplicateApplication } from "@/lib/applications/dedupe";
import { getLatestPublishedTermsVersion } from "@/lib/terms";
import { termsClickwrapLabel } from "@/lib/policies/clickwrap";
import { notifyOwnersEvent } from "@/lib/notifications";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`apply:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = applicationSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Honeypot: a bot fills every field, including ones humans never see.
  if (input.website) {
    return NextResponse.json({ ok: true }); // pretend success, no record created
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

  const [created] = await db
    .insert(application)
    .values({
      businessLegalName: input.businessLegalName,
      channelType: input.channelType,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 || null,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      channelEvidenceUrl: input.channelEvidenceUrl || null,
      sellersPermitNumber: input.sellersPermitNumber || null,
      resumeTokenHash: hashToken(rawResumeToken),
      resumeTokenExpiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      triageScore: score,
      needsReviewReasons: reasons,
      status: "submitted",
      submittedAt: new Date(),
    })
    .returning();

  // Berman-compliant clickwrap evidence, captured at the exact moment of
  // submission: the visible checkbox language, the immutable published
  // terms_version it links to, and the request's own IP/UA/page context
  // (build prompt §12, test gate #20).
  await db.insert(termsAcceptance).values({
    applicationId: created!.id,
    termsVersionId: termsVersion.id,
    visibleLanguageSnapshot: termsClickwrapLabel(termsVersion.versionLabel),
    ip,
    userAgent: req.headers.get("user-agent") ?? "unknown",
    pageContext: "/apply",
  });

  await recordAudit({
    actorType: "applicant",
    action: "application.submitted",
    entityType: "application",
    entityId: created!.id,
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  const resumeUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/apply/continue?token=${rawResumeToken}`;
  // Best-effort: the application is already saved; a failed confirmation
  // email must not 500 the submission (would cause duplicate applications).
  await sendNotificationEmail({
    to: input.contactEmail,
    subject: "Your Fanzia wholesale application",
    text: `Thanks for applying to Fanzia wholesale. You can check your application status or add documents any time at:\n\n${resumeUrl}\n\nThis link is valid for ${ttlHours} hours.`,
  }, "application.confirmation");

  const reviewUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/admin/applications/${created!.id}`;
  await notifyOwnersEvent({
    type: "application_submitted",
    title: `New wholesale application — ${input.businessLegalName}`,
    body:
      `${input.businessLegalName} (${input.contactEmail}) submitted a wholesale application ` +
      `(triage score ${score}).` +
      (reasons.length ? `\n\nFlags for review:\n- ${reasons.join("\n- ")}` : "") +
      `\n\nReview: ${reviewUrl}`,
    actorEmail: input.contactEmail,
    entityType: "application",
    entityId: created!.id,
  });

  return NextResponse.json({ ok: true });
}
