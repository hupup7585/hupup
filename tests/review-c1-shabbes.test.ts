import { describe, expect, it } from "vitest";
import { bookingLock, calendarDefaults, candleMinutes, openNow } from "@/lib/jewish-calendar";
import { calendarRules, checkCalendarValues } from "@/lib/setting-rules";
import { readFileSync } from "node:fs";

/* Hark's Phase 1-2 review C1 (Nov 26, 2026): "Reopen after Shabbes" must never open the hotline or bookings during
 * Shabbes. Saturday January 16, 2027 in Monroe: sunset about 4:55 PM Eastern. */
const at = (iso: string) => new Date(iso);
const S = (over: Record<string, string>) => ({ ...calendarDefaults(), ...over });

describe("reopen after Shabbes", () => {
  it("the Calendar page and All settings refuse 0, 10 and 30; accept tzeis and 50 to 120", () => {
    for (const v of ["0", "10", "30", "49", "121", "soon", ""]) expect(calendarRules.reopenAfter(v), v).toBeTruthy();
    for (const v of ["tzeis", "50", "72", "120"]) expect(calendarRules.reopenAfter(v), v).toBeNull();
    expect(checkCalendarValues({ reopenAfter: "10" })).toMatch(/50 to 120/);
    expect(readFileSync("src/app/admin/(app)/settings/calendar-actions.ts", "utf8")).toContain("checkCalendarValues(");
  });
  it("even a stored small number can never open before nightfall", () => {
    // 5:05 PM: before nightfall; 10 or 0 minutes after sunset used to open here
    for (const v of ["0", "10", "30"]) {
      expect(bookingLock(at("2027-01-16T22:05:00Z"), S({ reopenAfter: v })).locked, v).toBe(true);
      expect(openNow(at("2027-01-16T22:05:00Z"), S({ reopenAfter: v })).open, v).toBe(false);
    }
  });
  it("the default (72, Rabbeinu Tam) is unchanged: locked at 6:00 PM, open by 6:15 PM", () => {
    expect(bookingLock(at("2027-01-16T23:00:00Z"), S({})).locked).toBe(true);
    expect(bookingLock(at("2027-01-16T23:15:00Z"), S({})).locked).toBe(false);
  });
  it("candle lighting: 10 to 60 minutes; 0 or nonsense falls back to the earlier, safer 18", () => {
    expect(candleMinutes("15")).toBe(15);
    expect(candleMinutes("0")).toBe(18);
    expect(candleMinutes("abc")).toBe(18);
    expect(calendarRules.candleLightingMinutes("5")).toBeTruthy();
  });
  it("the protected switch and the zmanim location", () => {
    expect(calendarRules.calendarEnabled("no")).toMatch(/protected/);
    expect(calendarRules.calendarLatitude("0")).toBeTruthy();
    expect(calendarRules.calendarLatitude("41.3407")).toBeNull();
  });
});
