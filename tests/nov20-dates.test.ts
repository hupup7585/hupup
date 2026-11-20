import { describe, expect, it } from "vitest";
import { lastPhoneDate, parseDigitsDate } from "@/lib/ivr/parse";
import { closedDayOffer } from "@/lib/holiday-rentals";
import { PROMPTS } from "@/lib/ivr/prompts";

/* Abraham, Nov 20, 2026: phone bookings up to 3 months ahead; past, too far and not understood lines; the closed-day
 * offer (the day before to the day after); the event date prompt; no quantity lines. */
const TODAY = "2026-11-20";

describe("phone dates", () => {
  it("up to the next three months; a recent past date has passed; a date next year past the limit is too far", () => {
    expect(lastPhoneDate(TODAY)).toBe("2027-02-20");
    expect(lastPhoneDate("2026-11-30")).toBe("2027-02-28");
    expect(parseDigitsDate("1225", TODAY)).toEqual({ ok: true, date: "2026-12-25" });
    expect(parseDigitsDate("0220", TODAY)).toEqual({ ok: true, date: "2027-02-20" });
    expect(parseDigitsDate("0221", TODAY)).toEqual({ ok: false, reason: "too_far" });
    expect(parseDigitsDate("1015", TODAY)).toEqual({ ok: false, reason: "past" }); // last month
    expect(parseDigitsDate("0515", TODAY)).toEqual({ ok: false, reason: "too_far" }); // next May is closer than last May
    expect(parseDigitsDate("1340", TODAY)).toEqual({ ok: false, reason: "invalid" });
  });
  it("the approved lines, word for word", () => {
    expect(PROMPTS.book_date_prompt.text).toBe("Using your keypad, please enter your event date: two digits for the month, then two digits for the day. For example, for March fifth, press 0, 3, 0, 5.");
    expect(PROMPTS.date_past.text).toBe("The date you picked has already passed, please pick another date.");
    expect(PROMPTS.date_too_far.text).toBe("We can book up to the next three months, please pick another date.");
    expect(PROMPTS.date_unclear.text).toBe("Sorry, I did not get that date. Please try that again.");
    expect(PROMPTS.book_date_entered.text).toBe("You entered {date}. If that is correct, press pound to continue. To enter a different date, press 1.");
    expect(PROMPTS.category_empty.text).toBe("Sorry, nothing is available in that section right now.");
    expect(PROMPTS.closed_day_offer.text).toBe("We are closed on {date} for {reason}. You can get it the day before, on {before}, in the morning before 12:00 PM, and keep it until {after}, at 9:00 AM, for a total of {price}. To book it, press 1. Otherwise, please pick another date.");
    expect(PROMPTS).not.toHaveProperty("qty_prompt");
    expect(PROMPTS).not.toHaveProperty("qty_invalid");
    for (const k of ["box151", "box151_none", "keep_shopping"] as const) expect(PROMPTS[k].text).not.toContain("shopping cart, press 0");
    expect(PROMPTS.resume_added.text).toContain("To go to your shopping cart, press 0.");
    const all = Object.values(PROMPTS).map((p) => p.text).join(" ");
    expect(all).not.toMatch(/\b(?:don't|can't|won't|we're|you're|it's|let's|isn't|didn't|we'll|you'll)\b/i);
  });
});

describe("closed-day offer", () => {
  const closed = (set: string[]) => (iso: string) => set.includes(iso);
  it("only when the day before and the day after are both open; 1.5 times on a regular day", () => {
    const o = closedDayOffer("2026-11-28", TODAY, {}, closed(["2026-11-28"])); // a plain Shabbes
    expect(o).toEqual({ before: "2026-11-27", after: "2026-11-29", days: 1.5, spanDays: 1.5 });
    expect(closedDayOffer("2026-11-28", TODAY, {}, closed(["2026-11-28", "2026-11-29"]))).toBeNull();
    expect(closedDayOffer("2026-11-28", TODAY, {}, closed(["2026-11-27", "2026-11-28"]))).toBeNull();
    expect(closedDayOffer(TODAY, TODAY, {}, closed([TODAY]))).toBeNull(); // the day before has passed
  });
  it("Chanukah or Chol Hamoed: two full day prices; a Friday with Mutze Shabbes: its own days (box 149)", () => {
    // Chanukah 2026 starts the night of Friday, December 4; Shabbes Chanukah is December 5 (the day before is Friday)
    // Shabbes Chanukah (December 12): the Friday before is a Chanukah Friday, kept for Mutze Shabbes (box 149's days)
    const fri = closedDayOffer("2026-12-12", TODAY, {}, closed(["2026-12-12"]));
    expect(fri).toEqual({ before: "2026-12-11", after: "2026-12-13", days: 1.5, spanDays: null });
    // A plain weekday closed in Chanukah week (Owner closure): both sides are Chanukah days
    const wk = closedDayOffer("2026-12-08", TODAY, {}, closed(["2026-12-08"]));
    expect(wk?.days).toBe(2);
    expect(wk?.spanDays).toBe(2);
  });
});
