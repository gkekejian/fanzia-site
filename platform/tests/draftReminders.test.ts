import { describe, it, expect } from "vitest";
import { isDraftAbandoned, ABANDONED_DRAFT_AFTER_MS } from "@/lib/catalog/draftReminders";

const NOW = new Date("2026-09-18T12:00:00Z");
const OLD = new Date(NOW.getTime() - ABANDONED_DRAFT_AFTER_MS - 60_000);
const FRESH = new Date(NOW.getTime() - 60_000);

const draftWithLines = (updatedAt: Date) => ({
  lines: [{ productId: "11111111-1111-1111-1111-111111111111", qtyRequested: 3 }],
  updatedAt,
});

describe("isDraftAbandoned", () => {
  it("abandoned: old draft with lines, no newer order, no reminder sent", () => {
    expect(isDraftAbandoned(draftWithLines(OLD), 0, null, NOW)).toBe(true);
  });

  it("not abandoned: draft touched within the last 24h", () => {
    expect(isDraftAbandoned(draftWithLines(FRESH), 0, null, NOW)).toBe(false);
  });

  it("not abandoned: empty draft", () => {
    expect(isDraftAbandoned({ lines: [], updatedAt: OLD }, 0, null, NOW)).toBe(false);
  });

  it("not abandoned: null draft", () => {
    expect(isDraftAbandoned(null, 0, null, NOW)).toBe(false);
  });

  it("not abandoned: an order request was created after the draft", () => {
    expect(isDraftAbandoned(draftWithLines(OLD), 1, null, NOW)).toBe(false);
  });

  it("not abandoned: reminder already sent for this draft version", () => {
    expect(isDraftAbandoned(draftWithLines(OLD), 0, { draftUpdatedAt: OLD }, NOW)).toBe(false);
  });

  it("abandoned again: draft edited after the last reminder (new updatedAt)", () => {
    const editedAt = new Date(OLD.getTime() - 3600_000);
    expect(isDraftAbandoned(draftWithLines(editedAt), 0, { draftUpdatedAt: OLD }, NOW)).toBe(true);
  });
});
