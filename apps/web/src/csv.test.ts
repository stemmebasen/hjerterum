import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("parses MembershipWorks-style CSV including quoted commas", () => {
    expect(parseCsv('Email,Name,Status\nanna@example.dk,"Ananda, Anna",Active\n')).toEqual([
      { Email: "anna@example.dk", Name: "Ananda, Anna", Status: "Active" }
    ]);
  });

  it("preserves line breaks inside quoted fields", () => {
    expect(parseCsv('Email,Notes\na@example.dk,"Linje 1\nLinje 2"\n')[0]?.Notes).toBe("Linje 1\nLinje 2");
  });

  it("rejects malformed quoted input", () => {
    expect(() => parseCsv('Email,Name\na@example.dk,"Anna')).toThrow("csv_unclosed_quote");
  });
});
