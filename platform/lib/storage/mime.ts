/**
 * Content-based MIME sniffing (build prompt §13: "Validate MIME from file
 * content, not extension"). Intentionally allow-listed and small — this
 * app only ever needs to accept photographic evidence and permit/
 * certificate documents, never executables or scripts. Returns null for
 * anything unrecognized, which callers must treat as a rejection.
 */
const SIGNATURES: Array<{ mime: string; check: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", check: (b) => b.subarray(0, 4).toString("ascii") === "%PDF" },
  {
    mime: "image/jpeg",
    check: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    check: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    check: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    mime: "image/gif",
    check: (b) => {
      const header = b.subarray(0, 6).toString("ascii");
      return header === "GIF87a" || header === "GIF89a";
    },
  },
];

export const ALLOWED_MIME_TYPES = SIGNATURES.map((s) => s.mime);

export function sniffMime(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return sig.mime;
  }
  return null;
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB
