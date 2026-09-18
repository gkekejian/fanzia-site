import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./testDb";
import { user } from "@/db/schema";
import {
  ingestContactMessage,
  listContactMessages,
  getContactThread,
  setContactMessageStatus,
  replyToContactMessage,
  IngestAuthError,
  NotFoundError,
  InvalidStatusError,
} from "@/lib/contactMessages";
import type { Actor } from "@/lib/auth/rbac";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

const SECRET = "test-ingest-secret";

async function seedOwnerActor(db: TestDb): Promise<Actor> {
  const [u] = await db
    .insert(user)
    .values({ email: "owner@example.com", name: "Owner", role: "owner" })
    .returning({ id: user.id, email: user.email, name: user.name, role: user.role });
  return { kind: "owner", user: { id: u!.id, email: u!.email, name: u!.name, role: u!.role as "owner" } };
}

describe("website contact inbox", () => {
  let db: TestDb;
  let actor: Actor;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    actor = await seedOwnerActor(db);
    process.env.CONTACT_INGEST_SECRET = SECRET;
  });

  it("ingests a message with the correct secret, status new", async () => {
    const row = await ingestContactMessage(
      { name: "Jane Visitor", email: "jane@example.com", message: "Do you ship to Texas?" },
      SECRET,
      db,
    );
    expect(row.id).toBeTruthy();
    const { message } = await getContactThread(row.id, db);
    expect(message.status).toBe("new");
    expect(message.name).toBe("Jane Visitor");
  });

  it("rejects ingest with a wrong secret", async () => {
    await expect(
      ingestContactMessage({ name: "X", email: "x@example.com", message: "hi" }, "wrong", db),
    ).rejects.toThrow(IngestAuthError);
  });

  it("rejects ingest when no secret is configured", async () => {
    delete process.env.CONTACT_INGEST_SECRET;
    await expect(
      ingestContactMessage({ name: "X", email: "x@example.com", message: "hi" }, SECRET, db),
    ).rejects.toThrow(IngestAuthError);
  });

  it("rejects invalid input", async () => {
    await expect(
      ingestContactMessage({ name: "", email: "not-an-email", message: "" }, SECRET, db),
    ).rejects.toThrow();
  });

  it("lists with a status filter", async () => {
    const a = await ingestContactMessage({ name: "A", email: "a@example.com", message: "one" }, SECRET, db);
    await ingestContactMessage({ name: "B", email: "b@example.com", message: "two" }, SECRET, db);
    await setContactMessageStatus(a.id, "open", actor, db);

    expect((await listContactMessages(undefined, db)).length).toBe(2);
    expect((await listContactMessages("new", db)).length).toBe(1);
    expect((await listContactMessages("open", db)).length).toBe(1);
  });

  it("reply stores the reply, marks the thread replied (email is logged-only in tests)", async () => {
    const { id } = await ingestContactMessage(
      { name: "Jane", email: "jane@example.com", subject: "Hours", message: "When are you open?" },
      SECRET,
      db,
    );
    const reply = await replyToContactMessage(id, { body: "Tue–Sat, 11am–6pm." }, actor, db);
    expect(reply.id).toBeTruthy();

    const { message, replies } = await getContactThread(id, db);
    expect(message.status).toBe("replied");
    expect(replies.length).toBe(1);
    expect(replies[0]!.body).toBe("Tue–Sat, 11am–6pm.");
  });

  it("reply requires a non-empty body", async () => {
    const { id } = await ingestContactMessage({ name: "J", email: "j@example.com", message: "hi" }, SECRET, db);
    await expect(replyToContactMessage(id, { body: "   " }, actor, db)).rejects.toThrow();
  });

  it("reply to a missing thread throws NotFoundError", async () => {
    await expect(
      replyToContactMessage("00000000-0000-0000-0000-000000000000", { body: "hi" }, actor, db),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects unknown statuses", async () => {
    await expect(listContactMessages("bogus", db)).rejects.toThrow(InvalidStatusError);
    const { id } = await ingestContactMessage({ name: "J", email: "j@example.com", message: "hi" }, SECRET, db);
    await expect(setContactMessageStatus(id, "bogus", actor, db)).rejects.toThrow(InvalidStatusError);
  });
});
