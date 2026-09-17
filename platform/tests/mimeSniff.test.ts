import { describe, it, expect } from "vitest";
import { sniffMime, ALLOWED_MIME_TYPES } from "@/lib/storage/mime";

// Build prompt §13 / test gate #19: "Upload tests reject spoofed MIME
// types ... and executables."
describe("sniffMime", () => {
  it("accepts a real PDF by magic bytes", () => {
    const buf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20)]);
    expect(sniffMime(buf)).toBe("application/pdf");
  });

  it("accepts a real PNG by magic bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    expect(sniffMime(buf)).toBe("image/png");
  });

  it("rejects a Windows executable renamed to look like a PDF", () => {
    // MZ header — a real .exe's magic bytes — regardless of the filename/extension a caller might present.
    const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(sniffMime(buf)).toBeNull();
    expect(ALLOWED_MIME_TYPES).not.toContain("application/x-msdownload");
  });

  it("rejects an ELF executable", () => {
    const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(sniffMime(buf)).toBeNull();
  });

  it("rejects a shell script disguised with a .pdf name (content has no valid signature)", () => {
    const buf = Buffer.from("#!/bin/sh\nrm -rf /\n");
    expect(sniffMime(buf)).toBeNull();
  });

  it("rejects plain text claiming to be a PDF by extension alone", () => {
    const buf = Buffer.from("this is not actually a pdf");
    expect(sniffMime(buf)).toBeNull();
  });
});
