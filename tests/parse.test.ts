import { describe, expect, it } from "vitest";
import { normalizeSpokenEmail, normalizeSpokenName, parseDigitsDate, parseSpokenDate } from "@/lib/ivr/parse";

const TODAY = "2026-11-01"; // a Sunday

describe("keypad dates", () => {
  it("MMDD this year", () => expect(parseDigitsDate("1108", TODAY)).toEqual({ ok: true, date: "2026-11-08" }));
  it("MMDD rolls to next year when passed", () => expect(parseDigitsDate("0615", TODAY)).toEqual({ ok: true, date: "2027-06-15" }));
  it("today is allowed", () => expect(parseDigitsDate("1101", TODAY)).toEqual({ ok: true, date: "2026-11-01" }));
  it("rejects bad month", () => expect(parseDigitsDate("1308", TODAY).ok).toBe(false));
  it("rejects Feb 30", () => expect(parseDigitsDate("0230", TODAY).ok).toBe(false));
  it("MMDDYYYY", () => expect(parseDigitsDate("12252026", TODAY)).toEqual({ ok: true, date: "2026-12-25" }));
  it("MMDDYYYY in the past", () => expect(parseDigitsDate("01012026", TODAY)).toEqual({ ok: false, reason: "past" }));
});

describe("spoken dates", () => {
  const cases: [string, string][] = [
    ["November 8th.", "2026-11-08"],
    ["Sunday, November 8", "2026-11-08"],
    ["the 8th of November", "2026-11-08"],
    ["november twenty first", "2026-11-21"],
    ["December thirty first", "2026-12-31"],
    ["11/8", "2026-11-08"],
    ["tomorrow", "2026-11-02"],
    ["today", "2026-11-01"],
    ["this Friday", "2026-11-06"],
    ["next Sunday", "2026-11-08"],
    ["June 15", "2027-06-15"],
    ["the 20th", "2026-11-20"],
  ];
  for (const [input, want] of cases) {
    it(input, () => expect(parseSpokenDate(input, TODAY)).toEqual({ ok: true, date: want }));
  }
  it("gibberish", () => expect(parseSpokenDate("I want a castle", TODAY).ok).toBe(false));
});

describe("spoken details", () => {
  it("email", () => expect(normalizeSpokenEmail("Yossi at gmail dot com.")).toBe("yossi@gmail.com"));
  it("email with underscore", () => expect(normalizeSpokenEmail("moshe underscore k at yahoo dot com")).toBe("moshe_k@yahoo.com"));
  it("bad email", () => expect(normalizeSpokenEmail("no thanks")).toBeNull());
  it("name", () => expect(normalizeSpokenName("my name is yossi friedman.")).toBe("Yossi Friedman"));
});
