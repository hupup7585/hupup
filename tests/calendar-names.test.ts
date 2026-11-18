import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dayHolidayNames } from "@/lib/hup-calendar/day-names";

/* Calendar: search a date, and every Yom Tov name in English with the day of Chanukah (Abraham, Nov 17, 2026). */
describe("holiday names on the calendars", () => {
  it("Chanukah 5787: first candle Friday night December 4, day 1 to day 8 = December 5 to 12, 2026", () => {
    expect(dayHolidayNames("2026-12-04")).toEqual(["Erev Chanukah (first candle tonight)"]);
    for (let n = 1; n <= 8; n++) expect(dayHolidayNames(`2026-12-${String(4 + n).padStart(2, "0")}`)).toContain(`Chanukah, day ${n}`);
    expect(dayHolidayNames("2026-12-13")).toEqual([]);
  });
  it("Yom Tov days are numbered; Chol Hamoed names its Yom Tov", () => {
    expect(dayHolidayNames("2026-09-12")).toEqual(["Rosh Hashanah, day 1"]);
    expect(dayHolidayNames("2026-09-13")).toEqual(["Rosh Hashanah, day 2"]);
    expect(dayHolidayNames("2026-09-21")).toEqual(["Yom Kippur"]);
    expect(dayHolidayNames("2026-09-26")).toEqual(["Sukkos, day 1"]);
    expect(dayHolidayNames("2026-09-28")).toEqual(["Chol Hamoed Sukkos"]);
    expect(dayHolidayNames("2026-10-02")).toEqual(["Hoshana Rabbah"]);
    expect(dayHolidayNames("2026-10-03")).toEqual(["Shemini Atzeres"]);
    expect(dayHolidayNames("2026-10-04")).toEqual(["Simchas Torah"]);
    expect(dayHolidayNames("2027-03-23")).toEqual(["Purim"]);
    expect(dayHolidayNames("2027-04-22")).toEqual(["Pesach, day 1"]);
    expect(dayHolidayNames("2027-04-25")).toEqual(["Chol Hamoed Pesach"]);
    expect(dayHolidayNames("2027-04-29")).toEqual(["Pesach, day 8"]);
    expect(dayHolidayNames("2027-06-12")).toEqual(["Shavuos, day 2"]);
    expect(dayHolidayNames("2027-08-12")).toEqual(["Tisha B'Av"]);
    expect(dayHolidayNames("2026-11-18")).toEqual([]);
  });
  it("both calendars show the names and have Search a date", () => {
    const month = readFileSync("src/app/admin/(app)/pos/MonthCalendar.tsx", "utf8");
    expect(month).toContain("dayHolidayNames(d.date)");
    expect(month).toContain("data-holiday-en");
    expect(month).toContain("data-date-search");
    const cal = readFileSync("src/app/admin/(app)/calendar/page.tsx", "utf8");
    expect(cal).toContain("dayHolidayNames(d)");
    expect(cal).toContain("data-holiday-en");
    expect(cal).toContain('name="day"');
  });
});
