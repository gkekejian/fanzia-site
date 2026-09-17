import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { application, applicationDocument, applicationStatusEvent, taxDetermination } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const rows = await db.select().from(application).where(eq(application.id, params.id)).limit(1);
  const app = rows[0];
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const documents = await db
    .select()
    .from(applicationDocument)
    .where(eq(applicationDocument.applicationId, app.id));
  const documentsWithUrls = await Promise.all(
    documents.map(async (doc) => ({ ...doc, url: await getSignedDownloadUrl(doc.storageKey) })),
  );

  const events = await db
    .select()
    .from(applicationStatusEvent)
    .where(eq(applicationStatusEvent.applicationId, app.id));

  const taxDeterminations = app.accountId
    ? await db.select().from(taxDetermination).where(eq(taxDetermination.accountId, app.accountId))
    : [];

  return NextResponse.json({ application: app, documents: documentsWithUrls, events, taxDeterminations });
}
