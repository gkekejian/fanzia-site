import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./testDb";
import { account, accountContact, buyerSession } from "@/db/schema";
import {
  CONTACT_ROLES,
  isValidContactRole,
  normalizeContactRole,
  canOrder,
  canManageContacts,
} from "@/lib/users/contactRoles";
import { createBuyerMagicLink, consumeBuyerMagicLink } from "@/lib/auth/buyerMagicLink";
import { createBuyerSession, getBuyerSessionContact } from "@/lib/auth/buyerSession";

describe("contactRoles", () => {
  it("defines exactly the three canonical roles", () => {
    expect([...CONTACT_ROLES].sort()).toEqual(["primary", "purchaser", "viewer"]);
  });

  it("validates role strings", () => {
    expect(isValidContactRole("primary")).toBe(true);
    expect(isValidContactRole("purchaser")).toBe(true);
    expect(isValidContactRole("viewer")).toBe(true);
    expect(isValidContactRole("admin")).toBe(false);
    expect(isValidContactRole("")).toBe(false);
  });

  it("normalizes unknown and legacy values to least privilege", () => {
    expect(normalizeContactRole("primary")).toBe("primary");
    expect(normalizeContactRole("weird-legacy-value")).toBe("viewer");
    expect(normalizeContactRole(null)).toBe("viewer");
    expect(normalizeContactRole(undefined)).toBe("viewer");
  });

  it("permission matrix: primary and purchaser order, viewer does not", () => {
    expect(canOrder("primary")).toBe(true);
    expect(canOrder("purchaser")).toBe(true);
    expect(canOrder("viewer")).toBe(false);
  });

  it("permission matrix: only primary manages contacts", () => {
    expect(canManageContacts("primary")).toBe(true);
    expect(canManageContacts("purchaser")).toBe(false);
    expect(canManageContacts("viewer")).toBe(false);
  });
});

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

async function seedAccount(db: TestDb) {
  const [acct] = await db
    .insert(account)
    .values({
      legalName: "Test Buyer LLC",
      channelType: "other",
      addressLine1: "1 Test St",
      city: "Glendale",
      state: "CA",
      postalCode: "91206",
      primaryContactName: "Pat Buyer",
      primaryContactEmail: "pat@testbuyer.example",
    })
    .returning({ id: account.id });
  return acct!.id;
}

describe("inactive buyer contacts lose access", () => {
  it("createBuyerMagicLink returns null for a disabled contact", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    await db.insert(accountContact).values({
      accountId,
      name: "Disabled Dana",
      email: "dana@testbuyer.example",
      roleOnAccount: "purchaser",
      active: false,
    });
    expect(await createBuyerMagicLink("dana@testbuyer.example", db)).toBeNull();
  });

  it("createBuyerMagicLink works for an active contact", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    await db.insert(accountContact).values({
      accountId,
      name: "Active Al",
      email: "al@testbuyer.example",
      roleOnAccount: "viewer",
    });
    const link = await createBuyerMagicLink("al@testbuyer.example", db);
    expect(link).not.toBeNull();
    expect(link!.accountId).toBe(accountId);
  });

  it("consumeBuyerMagicLink refuses a link for a contact disabled after issuance", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const [contact] = await db
      .insert(accountContact)
      .values({ accountId, name: "Eddie", email: "eddie@testbuyer.example", roleOnAccount: "purchaser" })
      .returning({ id: accountContact.id });
    const link = await createBuyerMagicLink("eddie@testbuyer.example", db);
    expect(link).not.toBeNull();
    await db.update(accountContact).set({ active: false }).where(eq(accountContact.id, contact!.id));
    expect(await consumeBuyerMagicLink(link!.raw, db)).toBeNull();
  });

  it("getBuyerSessionContact resolves role and rejects disabled contacts", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const [contact] = await db
      .insert(accountContact)
      .values({ accountId, name: "Rita", email: "rita@testbuyer.example", roleOnAccount: "purchaser" })
      .returning({ id: accountContact.id });
    const { raw } = await createBuyerSession(contact!.id, accountId, {}, db);

    const authed = await getBuyerSessionContact(raw, db);
    expect(authed).not.toBeNull();
    expect(authed!.contactRole).toBe("purchaser");
    expect(authed!.contactEmail).toBe("rita@testbuyer.example");

    await db.update(accountContact).set({ active: false }).where(eq(accountContact.id, contact!.id));
    expect(await getBuyerSessionContact(raw, db)).toBeNull();
  });

  it("buyer sessions can be revoked by the owner kill-switch path", async () => {
    const { db } = await createTestDb();
    const accountId = await seedAccount(db);
    const [contact] = await db
      .insert(accountContact)
      .values({ accountId, name: "Sam", email: "sam@testbuyer.example", roleOnAccount: "primary" })
      .returning({ id: accountContact.id });
    const { raw } = await createBuyerSession(contact!.id, accountId, {}, db);
    // Mirrors the PATCH contact route's disable path: deactivate + revoke sessions.
    await db.update(accountContact).set({ active: false }).where(eq(accountContact.id, contact!.id));
    await db.update(buyerSession).set({ revokedAt: new Date() }).where(eq(buyerSession.accountContactId, contact!.id));
    expect(await getBuyerSessionContact(raw, db)).toBeNull();
  });
});
