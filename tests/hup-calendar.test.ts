import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADAR, ADAR2, NISAN, TISHREI, daysInYear, fixedFromISO, fromFixed, isLeapYear, isoFromFixed, newYear, toFixed, weekday } from "@/lib/hup-calendar/hebrew-date";
import { holidaysOn, PROPOSED_NAMES } from "@/lib/hup-calendar/holidays";
import { gematriya, renderEnglish, renderHebrew } from "@/lib/hup-calendar/names";
import { zmanim } from "@/lib/hup-calendar/zmanim";

/*
 * Hup Up's own Hebrew calendar (src/lib/hup-calendar). Before the old library was removed, this engine was checked
 * against it for every day from 2026-11-06 through 29 Elul 6000 (2240-09-16): identical holidays, names, dates and
 * open/closed results; sun times within 1 second until March 2100 (after that the old library was a day off).
 */
const KJ = { latitude: 41.3407, longitude: -74.1679 };
const on = (iso: string) => holidaysOn(fixedFromISO(iso)).map((h) => h.name);
const date = (y: number, m: number, d: number) => isoFromFixed(toFixed({ year: y, month: m, day: d }));
const eastern = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

describe("known dates (published calendars)", () => {
  it("5787 (2026-2027) holidays fall on the right days", () => {
    expect(on("2026-09-12")).toContain("Rosh Hashana 5787");
    expect(on("2026-09-21")).toContain("Yom Kippur");
    expect(on("2026-09-26")).toContain("Sukkos I");
    expect(on("2026-10-03")).toContain("Shmini Atzeres");
    expect(on("2026-10-04")).toContain("Simchas Torah");
    expect(on("2026-12-04")).toContain("Chanukah: 1 Candle");
    expect(on("2026-12-12")).toContain("Chanukah: 8th Day");
    expect(on("2026-12-20")).toContain("Asara B’Teves");
    expect(on("2027-03-23")).toContain("Purim"); // leap year: Adar II
    expect(on("2027-04-22")).toContain("Pesach I");
    expect(on("2027-05-25")).toContain("Lag BaOmer");
    expect(on("2027-06-11")).toContain("Shavuos I");
    expect(on("2027-07-22")).toContain("Tzom Tammuz");
    expect(on("2027-08-12")).toContain("Tish’a B’Av");
    expect(on("2027-10-02")).toContain("Rosh Hashana 5788");
    expect(on("2028-03-12")).toContain("Purim"); // ordinary year: Adar
  });
  it("far-future dates through the end of year 6000 (ששת אלפים)", () => {
    expect(isoFromFixed(newYear(5800))).toBe("2039-09-19");
    expect(date(5800, NISAN, 15)).toBe("2040-03-29");
    expect(isoFromFixed(newYear(5900))).toBe("2139-09-24");
    expect(date(5900, NISAN, 15)).toBe("2140-04-02");
    expect(isoFromFixed(newYear(6000))).toBe("2239-09-30");
    expect(date(6000, NISAN, 15)).toBe("2240-04-07");
    expect(isoFromFixed(newYear(6001) - 1)).toBe("2240-09-16"); // 29 Elul 6000, the last day
  });
  it("Hebrew dates read the same as before", () => {
    expect(renderEnglish(fromFixed(fixedFromISO("2026-12-05")))).toBe("25th of Kislev, 5787");
    expect(renderHebrew(fromFixed(fixedFromISO("2026-12-05")))).toBe("כ״ה כִּסְלֵו תשפ״ז");
    expect(renderHebrew(fromFixed(fixedFromISO("2027-02-21")))).toBe("י״ד אֲדָר א׳ תשפ״ז");
    expect(renderHebrew(fromFixed(fixedFromISO("2040-03-30")))).toBe("ט״ז נִיסָן ת״ת");
    expect(gematriya(15)).toBe("ט״ו");
    expect(gematriya(16)).toBe("ט״ז");
  });
});

describe("calendar rules hold for every year from 5787 to 6000", () => {
  it("year lengths, Rosh Hashanah, Yom Kippur, Pesach and Purim days of the week, leap years", () => {
    for (let y = 5787; y <= 6000; y++) {
      expect([353, 354, 355, 383, 384, 385]).toContain(daysInYear(y));
      expect(isLeapYear(y)).toBe([3, 6, 8, 11, 14, 17, 0].includes(y % 19));
      expect([0, 3, 5]).not.toContain(weekday(newYear(y))); // Lo ADU Rosh: never Sunday, Wednesday, Friday
      expect([0, 5]).not.toContain(weekday(toFixed({ year: y, month: TISHREI, day: 10 }))); // Yom Kippur never Friday/Sunday
      expect([1, 3, 5]).not.toContain(weekday(toFixed({ year: y, month: NISAN, day: 15 }))); // Pesach never Mon/Wed/Fri
      expect([1, 3, 6]).not.toContain(weekday(toFixed({ year: y, month: isLeapYear(y) ? ADAR2 : ADAR, day: 14 }))); // Purim never Mon/Wed/Shabbos
    }
  });
  it("every day converts to Hebrew and back exactly", () => {
    for (let rd = fixedFromISO("2026-11-01"); rd <= newYear(6001); rd++) expect(toFixed(fromFixed(rd))).toBe(rd);
  });
  it("fasts that fall on Shabbos move (Tisha B'Av to Sunday, Esther to Thursday)", () => {
    let found = 0;
    for (let y = 5787; y <= 6000; y++) {
      const av9 = toFixed({ year: y, month: 5, day: 9 });
      if (weekday(av9) !== 6) continue;
      found++;
      expect(holidaysOn(av9 + 1).map((h) => h.name)).toContain("Tish’a B’Av (observed)");
      expect(holidaysOn(av9).map((h) => h.name)).toContain("Erev Tish’a B’Av");
    }
    expect(found).toBeGreaterThan(20);
    const esther = (y: number) => holidaysOn(toFixed({ year: y, month: isLeapYear(y) ? ADAR2 : ADAR, day: 11 })).some((h) => h.key === "Ta'anit Esther");
    let moved = 0;
    for (let y = 5787; y <= 5850; y++) if (weekday(toFixed({ year: y, month: isLeapYear(y) ? ADAR2 : ADAR, day: 13 })) === 6) {
      expect(esther(y)).toBe(true);
      moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe("sun times for Kiryas Joel (in-house NOAA equations)", () => {
  it("chatzos on Erev Shabbos, November 13, 2026 is 11:40 AM; Shabbos ends at 5:21 PM", () => {
    expect(eastern(zmanim("2026-11-13", KJ).chatzos())).toBe("11:40 AM");
    expect(eastern(zmanim("2026-11-14", KJ).tzeis(8.5))).toBe("5:21 PM");
  });
  it("summer sunset after 8 PM, winter before 4:40 PM", () => {
    expect(eastern(zmanim("2027-06-21", KJ).sunset())).toMatch(/^8:3\d PM$/);
    expect(eastern(zmanim("2026-12-21", KJ).sunset())).toMatch(/^4:3\d PM$/);
  });
});

describe("names and the public website", () => {
  it("proposed English and Yiddish names are stored but not used until Abraham approves", () => {
    expect(PROPOSED_NAMES.chanukah).toEqual({ en: "Chanukah", yi: "חנוכה" });
    expect(PROPOSED_NAMES.cholHamoed).toEqual({ en: "Chol Hamoed", yi: "חול המועד" });
    const engine = readFileSync("src/lib/jewish-calendar.ts", "utf8");
    expect(engine).not.toMatch(/proposedEn|proposedYi|PROPOSED_NAMES/);
  });
  it("no outside calendar library, and nothing on the website uses the calendar", () => {
    expect(readFileSync("package.json", "utf8")).not.toContain("@hebcal");
    for (const f of ["src/app/page.tsx", "src/components/site/SiteFooter.tsx", "src/components/site/SiteHeader.tsx", "src/components/site/ServiceAreaC.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/hup-calendar|jewish-calendar|officeHours/);
    }
  });
});
