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
  it("Shabbos closed; Motzei Shabbos opens 2 hours after Shabbos ends, until 11:00 PM in winter", () => {
    // Nov 14, 2026: Shabbos ends (tzeis 8.5 deg) about 5:22 PM, so the office opens about 7:22 PM
    expect(officeOpenNow(at("2026-11-14T17:00:00Z"), S)).toBe(false); // Shabbos noon
    expect(officeOpenNow(at("2026-11-14T23:30:00Z"), S)).toBe(false); // 6:30 PM: Shabbos over, but < 2 hours
    expect(officeOpenNow(at("2026-11-15T00:30:00Z"), S)).toBe(true); // 7:30 PM
    expect(officeOpenNow(at("2026-11-15T03:59:00Z"), S)).toBe(true); // 10:59 PM
    expect(officeOpenNow(at("2026-11-15T04:00:00Z"), S)).toBe(false); // 11:00 PM
  });
  it("summer (daylight saving): Motzei Shabbos runs until 12:00 AM midnight", () => {
    expect(officeOpenNow(at("2027-06-20T03:59:00Z"), S)).toBe(true); // Sat Jun 19, 11:59 PM EDT
    expect(officeOpenNow(at("2027-06-20T04:00:00Z"), S)).toBe(false); // Sun 12:00 AM
    expect(officeOpenNow(at("2027-06-20T04:15:00Z"), S)).toBe(false); // 12:15 AM
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
    expect(l).toContain("Saturday night (Motzei Shabbos): from 2 hours after Shabbos ends until 11:00 PM in winter, 12:00 AM in summer");
    expect(S.hoursWebsiteNote).toBe("Please note that you can book at any time using our automated phone system.");
  });
  it("the hotline never hangs up for closed hours: booking stays 24/7, live person only in hours", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('if (!officeOpenNow(new Date(), settings)) sp(vr, ctx, "office_closed");');
    expect(flow).toContain("if (!list.targets.length || !officeOpenNow(new Date(), settings)) {"); // live person only in hours
    expect(flow).not.toContain("closed_now");
  });
});

describe("phone line holiday schedule (Abraham, phone system and admin only)", () => {
  // Finds each day by its Hebrew-calendar name (our own calendar), so the dates are never hand-typed.
  const findDay = async (re: RegExp, from = "2026-11-01", days = 400) => {
    const { dayInfo, addDaysISO } = await import("@/lib/jewish-calendar");
    let d = from;
    for (let i = 0; i < days; i++, d = addDaysISO(d, 1)) if (dayInfo(d).names.some((n) => re.test(n))) return d;
    throw new Error(`no day matching ${re}`);
  };
  it("closed on Shabbos, Yom Tov, Purim and Tisha B'Av; open on Chanukah and Lag Ba'Omer", async () => {
    const { dayInfo } = await import("@/lib/jewish-calendar");
    expect(dayInfo("2026-11-14").closed).toBe(true); // Shabbos
    expect(dayInfo(await findDay(/^Pesach I$/)).closed).toBe(true); // Yom Tov
    expect(dayInfo(await findDay(/^Purim$/)).closed).toBe(true);
    expect(dayInfo(await findDay(/^Tish['’]a B['’]Av$/)).closed).toBe(true);
    const chanukahWeekday = await findDay(/^Chanukah: 3 Candles$/);
    expect(dayInfo(chanukahWeekday).closed).toBe(false);
    expect(dayInfo(await findDay(/^Lag BaOmer$/)).closed).toBe(false);
  });
  it("closes by chatzos on Erev Shabbos and Erev Yom Tov; Chol Hamoed open until 10:30 PM", async () => {
    const { dayInfo } = await import("@/lib/jewish-calendar");
    expect(dayInfo("2026-11-13").closesAtLabel).toMatch(/^Erev Shabbos: closes at chatzos/);
    expect(dayInfo(await findDay(/^Erev Pesach$/)).closesAtLabel).toMatch(/^Erev Yom Tov: closes at chatzos/);
    expect(S.hoursCholHamoed).toBe("10:30-22:30");
    const chm = await findDay(/^Pesach IV \(CH['’]['’]M\)$/); // Sun Apr 25, 2027 (Pesach III that year is Shabbos)
    expect(chm).toBe("2027-04-25");
    expect(dayInfo(chm).closed).toBe(false);
    expect(officeOpenNow(at("2027-04-26T02:00:00Z"), S)).toBe(true); // 10:00 PM EDT
    expect(officeOpenNow(at("2027-04-26T02:31:00Z"), S)).toBe(false); // 10:31 PM
  });
  it("phone booking stays available 24/7 (the closed message still offers booking)", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.office_closed.text).toBe("Our office is closed right now, but you can book anytime using this automated system.");
  });
});
