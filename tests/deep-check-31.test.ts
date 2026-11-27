import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Deep check 31 (Nov 27, 2026): out-of-date Admin items. */
describe("deep check 31", () => {
  it("System status shows speech to text as Abraham turned it on (live with its keys)", async () => {
    const { blockers } = await import("@/lib/system-status").catch(() => ({ blockers: null }));
    const src = readFileSync("src/lib/system-status.ts", "utf8");
    expect(src).toMatch(/key: "speech-text",[\s\S]{0,200}active: sttActive\(env\)/);
    expect(blockers).toBeTruthy();
  });
  it("Open in Google Sheets is never greyed out; it says what is missing", () => {
    expect(readFileSync("src/components/ExportButtons.tsx", "utf8")).not.toMatch(/disabled/);
    expect(readFileSync("src/components/SheetsButton.tsx", "utf8")).toContain("Needs a Google sign-in setup first");
  });
  it("the close-by areas list says it is not used now", () => {
    const f = readFileSync("src/app/admin/(app)/settings/CalendarSettingsForm.tsx", "utf8");
    expect(f.match(/Not used now: since Nov 27, 2026/g)).toHaveLength(1);
  });
  it("the two same-day hours settings say what they still do: a change flags the two same-day notice recordings", () => {
    const flags = readFileSync("src/lib/recording-flags.ts", "utf8");
    for (const k of ["sameDayHoursClose", "sameDayHoursFar"]) expect(flags).toMatch(new RegExp(`setting:${k}".*same_day_notice_open", "same_day_notice_after"`));
    const ex = readFileSync("src/lib/config-explanations.ts", "utf8");
    expect(ex.match(/marks the two same-day notice recordings/g)).toHaveLength(2);
    expect(ex).not.toMatch(/sameDayHours(Close|Far): \{[^}]*Nothing today/);
  });
});
