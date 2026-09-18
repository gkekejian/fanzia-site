import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { processStripeWebhook, WebhookError } from "@/lib/invoicing/stripe";

/**
 * Stripe webhook endpoint. Reads the RAW body (no JSON parsing — signature
 * verification needs the exact bytes) and verifies the Stripe signature
 * with STRIPE_WEBHOOK_SECRET. Verification is skipped only when the secret
 * is unset AND NODE_ENV=test.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  try {
    const result = await processStripeWebhook(db, rawBody, signature);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof WebhookError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
