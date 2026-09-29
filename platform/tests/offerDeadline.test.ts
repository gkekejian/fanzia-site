import { describe, it, expect } from "vitest";
import { arrivalRange, formatDeadline, nextDeadline, parsePacificLocal, toPacificLocal } from "@/lib/offers/deadline";

describe("drop deadlines (Pacific)", () => {
  it("next Friday 5 PM PT at least a day away", () => {
    // Thu Oct 1 2026, 9:00 AM PDT -> Fri Oct 2 5:00 PM PDT (32h away)
    expect(nextDeadline("friday_5pm", new Date("2026-10-01T16:00:00Z")).toISOString()).toBe("2026-10-03T00:00:00.000Z");
    // Fri Oct 2, 9:00 AM PDT -> too close, so the following Friday
    expect(nextDeadline("friday_5pm", new Date("2026-10-02T16:00:00Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("Sunday 11:59 PM PT, across the DST change", () => {
    // DST ends Sun Nov 1 2026; Sun Nov 8 23:59 PST = Nov 9 07:59Z
    expect(nextDeadline("sunday_eod", new Date("2026-11-03T18:00:00Z")).toISOString()).toBe("2026-11-09T07:59:00.000Z");
    // Before the change: Sun Oct 25 23:59 PDT = Oct 26 06:59Z
    expect(nextDeadline("sunday_eod", new Date("2026-10-20T18:00:00Z")).toISOString()).toBe("2026-10-26T06:59:00.000Z");
  });

  it("round-trips owner input and formats for buyers", () => {
    const d = parsePacificLocal("2026-10-02T17:00")!;
    expect(d.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(toPacificLocal(d)).toBe("2026-10-02T17:00");
    expect(formatDeadline(d)).toMatch(/Fri, Oct 2, 5:00 PM PDT/);
    expect(parsePacificLocal("not a date")).toBeNull();
  });

  it("arrival range from the deadline plus lead time", () => {
    const d = parsePacificLocal("2026-10-02T17:00")!;
    expect(arrivalRange(d, 10, 15).label).toBe("Oct 12 – Oct 17");
    expect(arrivalRange(d, 10, 10).label).toBe("Oct 12");
  });
});
