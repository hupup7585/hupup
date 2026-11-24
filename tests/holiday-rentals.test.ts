import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { holidayFridayPickup, holidayWeek, noPromosOn, perDayRules } from "@/lib/holiday-rentals";
import { pickupDateFor } from "@/lib/availability";

/* Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026, approved). Chanukah 5787: Dec 5-12, 2026. */
describe("holiday rentals", () => {
  it("knows the weeks", () => {
    expect(holidayWeek("2026-12-07")).toBe("chanukah");
    expect(holidayWeek("2027-04-25")).toBe("cholHamoed");
    expect(holidayWeek("2026-11-23")).toBeNull();
  });
  it("a Friday rental in Chanukah is picked up Saturday night (after Shabbes), not Sunday; other Fridays as before", () => {
    expect(holidayFridayPickup("2026-12-11", {})).toBe("2026-12-12");
    expect(pickupDateFor("2026-12-11")).toBe("2026-12-12");
    expect(pickupDateFor("2026-11-20")).toBe("2026-11-22"); // an ordinary Friday: Sunday, as before
    expect(holidayFridayPickup("2026-12-11", { holidayPerDayChanukah: false })).toBeNull();
    // weekdays: picked up the next morning, as before
    expect(pickupDateFor("2026-12-08")).toBe("2026-12-09");
  });
  it("no promos, discounts or offers in those weeks (Admin switch)", () => {
    expect(noPromosOn("2026-12-08", {})).toBe(true);
    expect(noPromosOn("2026-12-08", { holidayNoPromos: false })).toBe(false);
    expect(noPromosOn("2026-11-23", {})).toBe(false);
    expect(perDayRules("2027-04-25", { holidayPerDayCholHamoed: false })).toBe(false);
    expect(readFileSync("src/lib/offers.ts", "utf8")).toContain("if (noPromosOn(o.eventDate, s as never)) return { discountCents: 0, note: null };");
  });
  it("Admin settings on the Offers page, Owner only", () => {
    const a = readFileSync("src/app/admin/(app)/offers/actions.ts", "utf8");
    expect(a.slice(a.indexOf("saveHolidayRentalsAction"))).toContain("await requireOwner()");
    expect(readFileSync("src/app/admin/(app)/offers/page.tsx", "utf8")).toContain("data-holiday-rentals");
  });
});
