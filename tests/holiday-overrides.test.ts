import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dayInfo, formatOverrides, overrideFor, parseOverrides } from "@/lib/jewish-calendar";
import { defaultDayText, hoursDefaults, lateHoursToday, officeOpenNow } from "@/lib/business-hours";
import { normalizeHours, ampm24 } from "@/app/admin/(app)/holidays/hours";
import { holidayRows } from "@/app/admin/(app)/holidays/data";

const base = hoursDefaults();
const withOwn = (text: string) => ({ ...base, calendarOverrides: text });
const at = (iso: string) => new Date(iso);

describe("Owner's day entries (Open or Closed, Hours, Notes)", () => {
  it("parse and write back; older lines without hours still work", () => {
    const m = parseOverrides("2027-04-25 open 10:30-23:00 Late night sale\n2027-01-01 closed Family simcha\n2027-05-02 open");
    expect(m.get("2027-04-25")).toEqual({ open: true, hours: "10:30-23:00", note: "Late night sale" });
    expect(m.get("2027-01-01")).toEqual({ open: false, hours: null, note: "Family simcha" });
    expect(m.get("2027-05-02")).toEqual({ open: true, hours: null, note: "" });
    expect(formatOverrides(m)).toBe("2027-01-01 closed Family simcha\n2027-04-25 open 10:30-23:00 Late night sale\n2027-05-02 open");
  });
  it("Closed overrides an ordinary open day for the phone system", () => {
    const s = withOwn("2026-11-16 closed Staff day off");
    expect(dayInfo("2026-11-16", s).closed).toBe(true);
    expect(dayInfo("2026-11-16", s).reason).toBe("Staff day off");
    expect(officeOpenNow(at("2026-11-16T16:00:00Z"), s)).toBe(false); // Mon 11 AM
  });
  it("Open with hours overrides the default hours (even a Chol Hamoed day), and the 'open late' line is not said", () => {
    const s = withOwn("2027-04-25 open 12:00-16:00");
    expect(officeOpenNow(at("2027-04-25T15:30:00Z"), s)).toBe(false); // 11:30 AM EDT, before 12:00
    expect(officeOpenNow(at("2027-04-25T17:00:00Z"), s)).toBe(true); // 1:00 PM
    expect(officeOpenNow(at("2027-04-25T20:30:00Z"), s)).toBe(false); // 4:30 PM, after 4:00
    expect(lateHoursToday(at("2027-04-25T17:00:00Z"), s)).toBeNull();
    expect(lateHoursToday(at("2027-04-25T17:00:00Z"), base)).toBe("cholHamoed"); // default still says it
  });
  it("Open on a closed day (e.g. Purim) opens it; without hours it uses that weekday's normal hours", () => {
    const purim = "2027-03-23"; // Tuesday
    expect(dayInfo(purim, base).closed).toBe(true);
    expect(officeOpenNow(at("2027-03-23T16:00:00Z"), withOwn(`${purim} open`))).toBe(true); // 12 PM EDT
    expect(overrideFor(purim, withOwn(`${purim} open Busy season`))?.note).toBe("Busy season");
  });
  it("hours accept everyday formats and must end the same day", () => {
    expect(normalizeHours("10:30 AM - 10:30 PM")).toBe("10:30-22:30");
    expect(normalizeHours("10:30am to 10:30pm")).toBe("10:30-22:30");
    expect(normalizeHours("10:30-22:30")).toBe("10:30-22:30");
    expect(normalizeHours("9 AM - 5 PM")).toBe("09:00-17:00");
    expect(normalizeHours("10 PM - 2 AM")).toBeNull();
    expect(normalizeHours("lunch")).toBeNull();
    expect(ampm24("10:30-22:30")).toBe("10:30 AM - 10:30 PM");
  });
});

describe("the admin list", () => {
  it("lists every holiday and Erev Yom Tov with the calendar's default, plus the Owner's own days", () => {
    const rows = holidayRows("2027-03-01", 120, withOwn("2027-03-02 closed Inventory"), ["2027-03-02"]);
    const by = Object.fromEntries(rows.map((r) => [r.date, r]));
    expect(by["2027-03-02"]).toMatchObject({ holiday: "Regular day", choice: "closed", note: "Inventory", defaultOpen: true });
    expect(by["2027-03-23"]).toMatchObject({ holiday: "פורים", defaultOpen: false, choice: "default" }); // Purim
    expect(by["2027-04-21"].holiday).toContain("ערב יום טוב"); // Erev Pesach, Hebrew-letter name on staff screens (Abraham P)
    expect(by["2027-04-21"].defaultHours).toMatch(/until chatzos \(\d+:\d\d (AM|PM)\)$/);
    expect(by["2027-04-22"]).toMatchObject({ holiday: "פסח", defaultOpen: false }); // Pesach I
    expect(by["2027-04-25"].defaultHours).toBe("10:30 AM to 10:30 PM"); // Chol Hamoed
    expect(defaultDayText("2027-04-22", base)).toEqual({ open: false, hours: "Closed (Pesach I)" });
  });
  it("is Owner-only, needs no database table, and nothing on the website uses it", () => {
    expect(readFileSync("src/app/admin/(app)/holidays/page.tsx", "utf8")).toContain("await requireOwner()");
    const a = readFileSync("src/app/admin/(app)/holidays/actions.ts", "utf8");
    expect((a.match(/await requireOwner\(\)/g) || []).length).toBe(2);
    expect(a).toContain('saveSetting("calendarOverrides"');
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/holidays", CalendarClock, "Holidays & hours", O]');
    for (const f of ["src/app/page.tsx", "src/components/site/SiteFooter.tsx", "src/components/site/SiteHeader.tsx"]) expect(readFileSync(f, "utf8")).not.toMatch(/admin\/holidays|calendarOverrides|overrideFor|holidayRows/);
  });
});
