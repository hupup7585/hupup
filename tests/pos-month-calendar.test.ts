import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gridStart, shiftMonth } from "@/app/admin/(app)/pos/MonthCalendar";

/* New booking month calendar (Abraham, Nov 17, 2026): preview only until he approves the screenshot. */
describe("New booking month calendar", () => {
  it("weeks start on Sunday", () => {
    expect(gridStart("2026-11")).toBe("2026-11-01"); // Nov 1, 2026 is a Sunday
    expect(gridStart("2026-12")).toBe("2026-11-29");
    expect(new Date(`${gridStart("2027-02")}T12:00:00Z`).getUTCDay()).toBe(0);
  });
  it("month arrows", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
  it("live keeps the old day row until approved; the summary stays", () => {
    const page = readFileSync("src/app/admin/(app)/pos/page.tsx", "utf8");
    expect(page).toContain("const MONTH_CALENDAR_LIVE_APPROVED = false;");
    expect(page).toContain('monthCalendar={MONTH_CALENDAR_LIVE_APPROVED || process.env.VERCEL_ENV !== "production"}');
    const form = readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8");
    expect(form).toContain("data-date-check");
    const cal = readFileSync("src/app/admin/(app)/pos/MonthCalendar.tsx", "utf8");
    expect(cal).toContain("disabled={off}");
    expect(cal).toContain('"Closes early"');
  });
});
