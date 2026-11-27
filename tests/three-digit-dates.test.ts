import { describe, expect, it } from "vitest";
import { parseDigitsDate } from "@/lib/ivr/parse";

/* Abraham, Nov 26, 2026, 11:03 PM: a date typed with 3 digits is M-DD. */
const TODAY = "2026-11-26";
describe("3-digit dates", () => {
  it("105 = January 5th, 2027 (a Tuesday); 113 = January 13th", () => {
    expect(parseDigitsDate("105", TODAY)).toMatchObject({ ok: true, date: "2027-01-05" });
    expect(new Date("2027-01-05T12:00:00Z").getUTCDay()).toBe(2);
    expect(parseDigitsDate("113", TODAY)).toMatchObject({ ok: true, date: "2027-01-13" });
  });
  it("4 digits still work: 1231 = December 31st", () => {
    expect(parseDigitsDate("1231", TODAY)).toMatchObject({ ok: true, date: "2026-12-31" });
  });
  it("931 (September has 30 days) is not valid; 2 digits are never guessed", () => {
    expect(parseDigitsDate("931", TODAY).ok).toBe(false);
    expect(parseDigitsDate("10", TODAY).ok).toBe(false);
    expect(parseDigitsDate("012", TODAY).ok).toBe(false);
  });
});
