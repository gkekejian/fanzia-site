import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createTestDb } from "./testDb";
import { user as userTable, totpCredential, magicLink } from "@/db/schema";

vi.mock("@/db/client", () => ({
  get db() {
    const t = (globalThis as { __reviewTestDb?: unknown }).__reviewTestDb;
    if (!t) throw new Error("review test db not set");
    return t;
  },
}));

import { requireActor } from "@/lib/auth/actor";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { consumeMagicLink } from "@/lib/auth/magicLink";
import { hashToken } from "@/lib/crypto";
import { PolicyPage } from "@/components/PolicyPage";
import { GET as verifyGet } from "@/app/api/auth/magic-link/verify/route";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
let db: TestDb;

beforeEach(async () => {
  ({ db } = await createTestDb());
  (globalThis as { __reviewTestDb?: unknown }).__reviewTestDb = db;
});

async function ownerWithSession(confirmedTotp: boolean) {
  const [owner] = await db
    .insert(userTable)
    .values({ email: `o-${Math.random()}@fanzia.io`, name: "Owner", role: "owner" })
    .returning();
  if (confirmedTotp) {
    await db.insert(totpCredential).values({ userId: owner!.id, secretEncrypted: "x", confirmedAt: new Date() });
  }
  const { raw } = await createSession(owner!.id, {}, db);
  return new NextRequest("http://localhost/api/admin/anything", {
    headers: { cookie: `${SESSION_COOKIE}=${raw}` },
  });
}

describe("2FA is enforced, not optional", () => {
  it("refuses an owner session with no confirmed TOTP (403 mfa_enrollment_required)", async () => {
    const res = await requireActor(await ownerWithSession(false));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
    expect(await (res as NextResponse).json()).toMatchObject({ error: "mfa_enrollment_required" });
  });

  it("accepts an owner session once TOTP is confirmed", async () => {
    const res = await requireActor(await ownerWithSession(true));
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((res as { kind: string }).kind).toBe("owner");
  });
});

describe("magic links", () => {
  async function issue() {
    const [owner] = await db
      .insert(userTable)
      .values({ email: `m-${Math.random()}@fanzia.io`, name: "Owner", role: "owner" })
      .returning();
    const raw = `tok-${Math.random()}`;
    await db.insert(magicLink).values({
      userId: owner!.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return raw;
  }

  it("consume is single-use even when called concurrently", async () => {
    const raw = await issue();
    const results = await Promise.all([consumeMagicLink(raw), consumeMagicLink(raw)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("GET on the emailed link does not consume the token (mail-scanner safe)", async () => {
    const raw = await issue();
    const res = await verifyGet(new NextRequest(`http://localhost/api/auth/magic-link/verify?token=${raw}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // Token is still usable after the scanner's GET.
    expect(await consumeMagicLink(raw)).not.toBeNull();
  });
});

describe("PolicyPage", () => {
  it("renders markdown as HTML instead of raw asterisks and hashes", () => {
    const html = renderToStaticMarkup(
      createElement(PolicyPage, {
        title: "Terms",
        body: "# Terms of Sale\n\n1. **All sales final.** No returns.\n   Continued line.\n2. Second <script>x</script>\n\n*Version 1*",
      }),
    );
    expect(html).toContain("<h1>Terms of Sale</h1>");
    expect(html).toContain("<strong>All sales final.</strong>");
    expect(html).toContain("Continued line.");
    expect(html).toContain("<em>Version 1</em>");
    expect(html).not.toContain("**");
    expect(html).not.toContain("<script>");
  });
});
