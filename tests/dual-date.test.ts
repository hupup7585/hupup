import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MESSAGE_DUAL_DATES, dualDate, dualDateTime, englishDate, hebrewDate, hebrewDayISO, messageDate } from "@/lib/dual-date";

/* Abraham: every date in both calendars, side by side, English first, then the Hebrew date (Yiddish month names). */
describe("double dates", () => {
  it("calendar days: 'Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז'", () => {
    expect(dualDate("2026-11-08")).toBe("Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז");
    expect(dualDate("2026-11-08", "short")).toBe("Sun, Nov 8, 2026 / כ״ח חשון"); // Abraham: dates always with the year
    expect(englishDate("2026-11-08")).toBe("Sunday, Nov 8, 2026");
    expect(dualDate("2026-09-12")).toBe("Saturday, Sep 12, 2026 / א׳ תשרי תשפ״ז");
    expect(hebrewDate("2026-12-05")).toBe("כ״ה כסלו תשפ״ז");
  });
  it("leap years name both Adars", () => {
    expect(hebrewDate("2027-02-21")).toBe("י״ד אדר א׳ תשפ״ז");
    expect(hebrewDate("2027-03-23")).toBe("י״ד אדר ב׳ תשפ״ז");
    expect(hebrewDate("2028-03-12")).toBe("י״ד אדר תשפ״ח"); // Purim in an ordinary year: just Adar
  });
  it("times of day: the Hebrew date turns over at nightfall", () => {
    const afternoon = new Date("2026-11-08T20:00:00Z"); // 3:00 PM in New York
    const night = new Date("2026-11-09T02:00:00Z"); // 9:00 PM in New York, after nightfall
    expect(hebrewDayISO(afternoon)).toBe("2026-11-08");
    expect(hebrewDayISO(night)).toBe("2026-11-09");
    expect(dualDateTime(afternoon)).toBe("Sun, Nov 8, 2026, 3:00 PM / כ״ח חשון תשפ״ז");
    expect(dualDateTime(night)).toBe("Sun, Nov 8, 2026, 9:00 PM / כ״ט חשון תשפ״ז");
  });
  it("texts and emails keep today's English date until Abraham approves the new wording", () => {
    expect(MESSAGE_DUAL_DATES).toBe(false);
    expect(messageDate("2026-11-08")).toBe("Sunday, November 8");
    expect(messageDate("2026-11-08", true)).toBe("Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז");
    for (const f of ["src/lib/ivr/flow.ts", "src/app/admin/(app)/orders/actions.ts", "src/app/admin/(app)/pos/actions.ts", "src/app/api/sola/webhook/route.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toContain("messageDate(");
      expect(s, f).not.toMatch(/body: `[^`]*longDate\(|msg = `[^`]*longDate\(|details =\s*`[^`]*longDate\(/);
    }
  });
  it("every screen that shows a date uses both calendars", () => {
    const pages = [
      "src/app/admin/deliveries/page.tsx",
      "src/app/admin/(app)/orders/page.tsx",
      "src/app/admin/(app)/orders/[id]/page.tsx",
      "src/app/admin/(app)/page.tsx",
      "src/app/admin/(app)/calendar/page.tsx",
      "src/app/admin/(app)/pos/PosForm.tsx",
      "src/app/admin/(app)/calls/page.tsx",
      "src/app/admin/(app)/activity/page.tsx",
      "src/app/admin/(app)/messages/page.tsx",
      "src/app/admin/(app)/voicemail/page.tsx",
      "src/app/admin/(app)/customers/[id]/page.tsx",
      "src/app/admin/(app)/compliance/page.tsx",
      "src/app/admin/(app)/holidays/HolidayTable.tsx",
      "src/app/pay/[orderId]/page.tsx",
    ];
    for (const f of pages) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toMatch(/DualDate|dualDate|dualDateTime|HebrewDay/);
      // the dashboard chart keeps its short "Nov 8" axis label, with the Hebrew day under it (<HebrewDay>)
      expect(s.replace(/shortDate\(w\.week\)\.replace\([^)]*\)\}<HebrewDay/, ""), f).not.toMatch(/\b(longDate|shortDate)\(/);
      expect(s, f).not.toMatch(/toLocaleDateString\(|toLocaleString\("en-US", \{ timeZone/); // money formatting is fine
    }
  });
  it("no holidays on the public website: the double-date code only knows dates", () => {
    const lib = readFileSync("src/lib/dual-date.ts", "utf8");
    expect(lib).not.toMatch(/from "[^"]*(holidays|jewish-calendar)"|holidaysOn\(/);
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).not.toMatch(/holidays|jewish-calendar|dayInfo/);
  });
});
