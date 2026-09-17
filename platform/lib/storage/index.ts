import { randomBytes } from "crypto";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";

const LOCAL_DIR = path.join(process.cwd(), ".data", "uploads");

function randomKey(): string {
  // Random object keys, never a guessable/sequential path (build prompt §13).
  return randomBytes(24).toString("hex");
}

function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

/**
 * Storage abstraction with two implementations, same fallback pattern used
 * for email (lib/email/send.ts): a local-disk stand-in for dev/test, and
 * Cloudflare R2 for real deployments. Neither this build nor its tests
 * ever talk to real R2 — no credentials exist for it yet
 * (PROJECT_SCOPE_FINAL.md §2/§8).
 */
export async function putObject(buffer: Buffer): Promise<{ key: string }> {
  const key = randomKey();
  if (r2Configured()) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    await client.send(
      new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: buffer }),
    );
    return { key };
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, key), buffer);
  return { key };
}

/** Returns a short-lived authorized URL in production; a local dev route in local mode. */
export async function getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  if (r2Configured()) {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
  // Local dev/test: an internal route that itself requires admin auth (see
  // app/api/admin/documents/[key]/route.ts) — not a public static path.
  return `/api/admin/documents/${key}`;
}

export async function readLocalObject(key: string): Promise<Buffer> {
  return readFile(path.join(LOCAL_DIR, key));
}

export function isR2Configured(): boolean {
  return r2Configured();
}
