import { describe, expect, it } from "vitest";
import { hoursDefaults, hoursLines, officeOpenNow, todayHours, websiteHoursLines } from "@/lib/business-hours";

/* Abraham, Nov 25, 2026, 3:44 PM: closed on Motzei Shabbes and Motzei Yom Tov. No Motzei hours anywhere. */
const s = hoursDefaults();

describe("Motzei Shabbes is closed", () => {
  it("the website hours (and key 7, which reads the same lines) have no Motzei line", () => {
    for (const lines of [websiteHoursLines(s), websiteHoursLines(s, true, true), hoursLines(s)]) {
      expect(lines.join("\n")).not.toMatch(/motzei|mutze|saturday night|winter|summer/i);
    }
    expect(websiteHoursLines(s, true, true)).toContain("Shabbes: Closed");
  });
  it("the office is closed at 9:00 PM ET on a Saturday night after Shabbes ends, and after midnight", () => {
    expect(officeOpenNow(new Date("2026-11-29T02:00:00Z"), s)).toBe(false); // Sat Nov 28, 9:00 PM ET
    expect(officeOpenNow(new Date("2026-11-29T04:45:00Z"), s)).toBe(false); // 11:45 PM ET
    expect(officeOpenNow(new Date("2026-11-29T05:15:00Z"), s)).toBe(false); // 12:15 AM ET Sunday
    expect(officeOpenNow(new Date("2026-11-29T18:00:00Z"), s)).toBe(true); // Sunday 11:00 AM ET: the regular Sunday hours
  });
  it("todayHours on Shabbos says closed, with no 'Open tonight'", () => {
    const t = todayHours(new Date("2026-11-28T17:00:00Z"), s); // Sat Nov 28, noon ET
    expect(t).toMatch(/^Closed today/);
    expect(t).not.toMatch(/tonight/i);
  });
});
