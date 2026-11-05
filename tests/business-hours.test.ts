import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hoursDefaults, hoursLines, officeOpenNow } from "@/lib/business-hours";

const S = hoursDefaults();
const at = (iso: string) => new Date(iso); // UTC instants; EST = UTC-5 (Nov-Mar), EDT = UTC-4

describe("office hours (Abraham 2026-11-06, Eastern time)", () => {
  it("Monday to Thursday 10:30 AM to 7:00 PM", () => {
    expect(officeOpenNow(at("2026-11-09T15:29:00Z"), S)).toBe(false); // Mon 10:29 AM EST
    expect(officeOpenNow(at("2026-11-09T15:30:00Z"), S)).toBe(true); // 10:30 AM
    expect(officeOpenNow(at("2026-11-12T23:59:00Z"), S)).toBe(true); // Thu 6:59 PM
    expect(officeOpenNow(at("2026-11-13T00:00:00Z"), S)).toBe(false); // Thu 7:00 PM
  });
  it("Friday opens 10:30 AM and closes at chatzos", () => {
    expect(officeOpenNow(at("2026-11-13T15:00:00Z"), S)).toBe(false); // 10:00 AM
    expect(officeOpenNow(at("2026-11-13T16:00:00Z"), S)).toBe(true); // 11:00 AM
    expect(officeOpenNow(at("2026-11-13T17:00:00Z"), S)).toBe(false); // 12:00 PM, after chatzos (~11:41)
  });
  it("Shabbos closed; Motzei Shabbos opens 2 hours after Shabbos ends, until 11:30 PM in winter", () => {
    // Nov 14, 2026: Shabbos ends (tzeis 8.5 deg) about 5:22 PM, so the office opens about 7:22 PM
    expect(officeOpenNow(at("2026-11-14T17:00:00Z"), S)).toBe(false); // Shabbos noon
    expect(officeOpenNow(at("2026-11-14T23:30:00Z"), S)).toBe(false); // 6:30 PM: Shabbos over, but < 2 hours
    expect(officeOpenNow(at("2026-11-15T00:30:00Z"), S)).toBe(true); // 7:30 PM
    expect(officeOpenNow(at("2026-11-15T04:29:00Z"), S)).toBe(true); // 11:29 PM
    expect(officeOpenNow(at("2026-11-15T04:30:00Z"), S)).toBe(false); // 11:30 PM
  });
  it("summer (daylight saving): Motzei Shabbos runs until 12:30 AM", () => {
    expect(officeOpenNow(at("2027-06-20T04:15:00Z"), S)).toBe(true); // Sun 12:15 AM EDT after Shabbos Jun 19
    expect(officeOpenNow(at("2027-06-20T04:31:00Z"), S)).toBe(false); // 12:31 AM
  });
  it("Sunday 11:30 AM to 7:00 PM", () => {
    expect(officeOpenNow(at("2026-11-15T16:00:00Z"), S)).toBe(false); // 11:00 AM
    expect(officeOpenNow(at("2026-11-15T16:30:00Z"), S)).toBe(true); // 11:30 AM
    expect(officeOpenNow(at("2026-11-16T00:00:00Z"), S)).toBe(false); // 7:00 PM
  });
  it("Chol Hamoed open until 10:30 PM; Yom Tov closed", () => {
    expect(officeOpenNow(at("2027-04-27T02:00:00Z"), S)).toBe(true); // Mon Apr 26 10:00 PM EDT, Chol Hamoed
    expect(officeOpenNow(at("2027-04-27T02:31:00Z"), S)).toBe(false); // 10:31 PM
    expect(officeOpenNow(at("2027-04-22T16:00:00Z"), S)).toBe(false); // Pesach I
  });
  it("hours are editable settings", () => {
    expect(officeOpenNow(at("2026-11-09T14:30:00Z"), { ...S, hoursMonThu: "09:00-17:00" })).toBe(true); // 9:30 AM
  });
  it("website lines and Abraham's note", () => {
    const l = hoursLines(S);
    expect(l[0]).toBe("Monday to Thursday: 10:30 AM to 7:00 PM");
    expect(l).toContain("Sunday: 11:30 AM to 7:00 PM");
    expect(l).toContain("Chol Hamoed: 10:30 AM to 10:30 PM");
    expect(l).toContain("Saturday night (Motzei Shabbos): from 2 hours after Shabbos ends until 11:30 PM in winter, 12:30 AM in summer");
    expect(S.hoursWebsiteNote).toBe("Please note that you can book at any time using our automated phone system.");
  });
  it("the hotline never hangs up for closed hours: booking stays 24/7, live person only in hours", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('if (!officeOpenNow(new Date(), await getSettings())) sp(vr, ctx, "office_closed");');
    expect(flow).toContain("if (config.forwardPhone() && officeOpen) sp(g, ctx, \"menu_operator\");");
    expect(flow).not.toContain("closed_now");
  });
});
