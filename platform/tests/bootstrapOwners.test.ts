import { describe, expect, it } from "vitest";
import { parseBootstrapOwnerEmails } from "../lib/bootstrap";

describe("parseBootstrapOwnerEmails", () => {
  it("returns an empty list when unset or blank", () => {
    expect(parseBootstrapOwnerEmails(undefined)).toEqual([]);
    expect(parseBootstrapOwnerEmails("")).toEqual([]);
    expect(parseBootstrapOwnerEmails("   ")).toEqual([]);
  });

  it("splits, trims, and lowercases emails", () => {
    expect(parseBootstrapOwnerEmails("George@Fanzia.io, joe@fanzia.io ")).toEqual([
      "george@fanzia.io",
      "joe@fanzia.io",
    ]);
  });

  it("deduplicates and drops entries without an @", () => {
    expect(parseBootstrapOwnerEmails("a@x.io, A@X.IO, not-an-email, b@x.io")).toEqual([
      "a@x.io",
      "b@x.io",
    ]);
  });
});
