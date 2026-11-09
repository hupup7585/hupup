import { describe, expect, it } from "vitest";
import { smsNumberDisplay } from "@/lib/sms-number";

/* Consent boxes always show the real texting number (Abraham, live bugs #3). */
describe("texting number shown with consent", () => {
  it("real hotline when the setting is missing or a placeholder", () => {
    expect(smsNumberDisplay({})).toBe("(845) 415-7585");
    expect(smsNumberDisplay({ TWILIO_PHONE_NUMBER: "+18450000000" })).toBe("(845) 415-7585");
    expect(smsNumberDisplay({ TWILIO_PHONE_NUMBER: "+18455550100" })).toBe("(845) 415-7585");
    expect(smsNumberDisplay({ TWILIO_PHONE_NUMBER: "+18454157585" })).toBe("(845) 415-7585");
  });
});

describe("public website hours (Abraham, live bugs #1, #2, #4)", () => {
  it("weekly lines only (never holidays), Motzei Shabbos winter and summer, refreshed on save and at least every minute", async () => {
    const { readFileSync } = await import("node:fs");
    const { websiteHoursLines } = await import("@/lib/business-hours");
    const lines = websiteHoursLines();
    expect(lines.join("\n")).toContain("Winter: 2 hours after Shabbos - 11:00 PM\nSummer: 2 hours after Shabbos - 12:00 AM");
    expect(lines.join(" ")).not.toMatch(/Chanuk|Pesach|Sukkos|Purim|Yom Tov|Chol Hamoed|holiday/i);
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toMatch(/calendarOverrides|holidaysOn|hoursWebsiteNote/);
    expect(page).toMatch(/export const revalidate = 60;/);
    expect(readFileSync("src/app/admin/(app)/settings/calendar-actions.ts", "utf8")).toContain('revalidatePath("/", "layout")');
  });
});
