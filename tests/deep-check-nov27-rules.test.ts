import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Deep check, Nov 27, 2026, 3:00 AM (docs/audit/2026-11-27-0300-deep-check.md): items 5, 6, 8, 9, 10, 11. */
import { deliveryFeeFor, fourthSundayDeliveryCents } from "@/lib/offer-delivery";
import { hasFourthSunday, OFFER_NOTES } from "@/lib/offers";
import { closedDayOffer } from "@/lib/holiday-rentals";
import { SETTING_DEFAULTS } from "@/lib/settings";

const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");

describe("deep check Nov 27: rules", () => {
  it("item 9: a free 4th Sunday added to a customer discount still pays twice the delivery", () => {
    const s = SETTING_DEFAULTS as never;
    const stacked = `Customer discount: 10% off + ${OFFER_NOTES.fourthSunday}`;
    expect(hasFourthSunday(stacked)).toBe(true);
    expect(hasFourthSunday(OFFER_NOTES.fourthSunday)).toBe(true);
    expect(hasFourthSunday("Customer discount: 10% off")).toBe(false);
    expect(hasFourthSunday(null)).toBe(false);
    expect(deliveryFeeFor("local", s, "2027-03-07", stacked)).toBe(fourthSundayDeliveryCents("local", s));
    expect(deliveryFeeFor("local", s, "2027-03-07", stacked)).toBe(2 * deliveryFeeFor("local", s, "2027-03-07", null));
  });

  it("item 5: the closed-day offer is refused when its day before is closed (today after the cut-off counts as closed)", () => {
    const s = SETTING_DEFAULTS as never;
    expect(closedDayOffer("2027-03-13", "2027-03-12", s, () => false)).not.toBeNull();
    expect(closedDayOffer("2027-03-13", "2027-03-12", s, (iso) => iso === "2027-03-12")).toBeNull();
    // every closed-day offer on the phone uses the check that includes the same-day cut-off
    expect(flow.split("cal as never, closedForOffer(cal))").length - 1).toBe(3);
    expect(flow).not.toMatch(/closedDayOffer\([^\n]*dayInfo\(iso, cal\)\.closed\)/);
    expect(flow).toMatch(/iso === todayISO\(\) && !sameDayOpen\(iso, calendarNow\(\), cal as never\)/);
  });

  it("items 6 and 8: welcome back finds a cart saved before Shabbes; days no longer bookable are left out", () => {
    expect(flow).toContain("async function cartSession(");
    expect(flow).toMatch(/shabbesSaved'\)::timestamptz > now\(\)/);
    expect(flow).toMatch(/checkEventDate\(r\.date, cal\)\.ok && sameDayOpen\(r\.date, calendarNow\(\), cal as never\)/);
  });

  it("item 10: the price spoken after the address uses the caller's offer (a 4th Sunday's double delivery)", () => {
    expect(flow).toContain("offerNoteForCaller(first.id");
    expect(flow).toMatch(/class OfferNoteOnly extends Error/);
  });


  it("item 13: waiting for staff with hold music is never cut off by the Shabbes cut-off check", () => {
    expect(flow).toMatch(/pay-confirm-how\|promo-\|staff-\)\/\.test\(action\)/);
  });

});


describe("deep check Nov 27: small fixes (29)", () => {
  it("29: a bad audio link signature is refused, never a crash", async () => {
    const { verifyR2AudioLink } = await import("@/lib/vm-audio");
    expect(verifyR2AudioLink("voicemail/x.mp3", String(Math.floor(Date.now() / 1000) + 600), "é".repeat(32))).toBe(false);
  });
});
