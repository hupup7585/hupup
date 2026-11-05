import { describe, expect, it } from "vitest";
import { addDaysISO, calendarDefaults, checkEventDate, dayInfo, nextOpenDay, openNow } from "@/lib/jewish-calendar";
import { pickupDateFor } from "@/lib/availability";

/* Full year 5787 (Sept 12, 2026 - Oct 1, 2027), Diaspora, Kiryas Joel zmanim, Abraham's defaults. */

const S = calendarDefaults();
const START = "2026-09-12"; // 1 Tishrei 5787
const END = "2027-10-01"; // 29 Elul 5787
const allDays: string[] = [];
for (let d = START; d <= END; d = addDaysISO(d, 1)) allDays.push(d);
const dow = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();
const etTime = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const YOM_TOV = [
  "2026-09-12", "2026-09-13", // Rosh Hashanah
  "2026-09-21", // Yom Kippur
  "2026-09-26", "2026-09-27", // Sukkos 1-2
  "2026-10-03", "2026-10-04", // Shemini Atzeres, Simchas Torah
  "2027-04-22", "2027-04-23", // Pesach 1-2
  "2027-04-28", "2027-04-29", // Pesach 7-8
  "2027-06-11", "2027-06-12", // Shavuos 1-2
];

describe("5787 defaults (Abraham's answers)", () => {
  it("the year has 385 days (leap year) and starts on Rosh Hashanah", () => {
    expect(allDays).toHaveLength(385);
    expect(dayInfo(START).hebrew).toBe("1st of Tishrei, 5787");
    expect(dayInfo(END).hebrew).toBe("29th of Elul, 5787");
  });
  it("every Shabbos is closed", () => {
    const sats = allDays.filter((d) => dow(d) === 6);
    expect(sats.length).toBeGreaterThanOrEqual(55);
    for (const d of sats) expect(dayInfo(d).closed, d).toBe(true);
  });
  it("every Yom Tov day is closed (Diaspora two-day Yom Tov)", () => {
    for (const d of YOM_TOV) expect(dayInfo(d).closed, d).toBe(true);
    expect(dayInfo("2026-09-26").reason).toBe("Sukkos I");
  });
  it("Chol Hamoed and Hoshana Rabbah are open (except Shabbos)", () => {
    for (const d of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2027-04-25", "2027-04-26", "2027-04-27"]) expect(dayInfo(d).closed, d).toBe(false);
    expect(dayInfo("2027-04-24").closed).toBe(true); // Shabbos Chol Hamoed
  });
  it("Chanukah is open (except Shabbos)", () => {
    for (const d of ["2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11"]) expect(dayInfo(d).closed, d).toBe(false);
    expect(dayInfo("2026-12-05").closed).toBe(true);
  });
  it("Purim and Tisha B'Av are closed; Shushan Purim is open", () => {
    expect(dayInfo("2027-03-23")).toMatchObject({ closed: true, reason: "Purim" });
    expect(dayInfo("2027-08-12").closed).toBe(true);
    expect(dayInfo("2027-03-24").closed).toBe(false);
  });
  it("minor fasts and Lag Ba'Omer are open", () => {
    for (const d of ["2026-09-14", "2026-12-20", "2027-03-22", "2027-07-22", "2027-05-25"]) expect(dayInfo(d).closed, d).toBe(false);
  });
  it("closed days in 5787: Shabbos + Yom Tov + Purim + Tisha B'Av, nothing else", () => {
    const closed = allDays.filter((d) => dayInfo(d).closed);
    const expected = new Set([...allDays.filter((d) => dow(d) === 6), ...YOM_TOV, "2027-03-23", "2027-08-12"]);
    expect(new Set(closed)).toEqual(expected);
  });
});

describe("Erev Shabbos and Erev Yom Tov close at chatzos (Kiryas Joel zmanim)", () => {
  it("every open Friday closes at chatzos, between 11:30 and 13:10 Eastern (later in daylight saving time)", () => {
    for (const d of allDays.filter((x) => dow(x) === 5 && !dayInfo(x).closed)) {
      const i = dayInfo(d);
      expect(i.closesAt, d).not.toBeNull();
      expect(i.closesAtLabel, d).toMatch(/closes at chatzos/);
      const t = etTime(i.closesAt!);
      expect(t >= "11:30" && t <= "13:10", `${d} ${t}`).toBe(true);
    }
  });
  it("examples: Nov 6, 2026 at 11:40 AM; Erev Pesach Apr 21, 2027 at 12:55 PM", () => {
    expect(etTime(dayInfo("2026-11-06").closesAt!)).toBe("11:40");
    expect(dayInfo("2027-04-21").closesAtLabel).toBe("Erev Yom Tov: closes at chatzos (12:55 PM)");
  });
  it("Erev Yom Tov days close at chatzos", () => {
    for (const d of ["2026-09-20", "2027-04-21", "2027-04-27", "2027-06-10"]) expect(dayInfo(d).closesAtLabel, d).toMatch(/^Erev Yom Tov: closes at chatzos/);
  });
  it("candle-lighting option is honored when chosen", () => {
    const i = dayInfo("2026-11-06", { ...S, erevShabbosClose: "candles", candleLightingMinutes: "18" });
    expect(i.closesAtLabel).toMatch(/closes at candle lighting \(4:2\d PM\)/);
  });
  it("reopens at tzeis after Shabbos / the last Yom Tov day, not between consecutive closed days", () => {
    expect(etTime(dayInfo("2026-11-07").reopensAt!)).toBe("17:27");
    expect(dayInfo("2026-09-12").reopensAt).toBeNull(); // RH 1 -> RH 2
    expect(dayInfo("2026-09-13").reopensAt).not.toBeNull();
    expect(etTime(dayInfo("2026-11-07", { ...S, reopenAfter: "72" }).reopensAt!)).toBe("17:56"); // sunset 4:44 PM + 72 minutes
  });
});

describe("open right now (hotline)", () => {
  it("Friday before chatzos open, after chatzos closed, Motzei Shabbos open after tzeis", () => {
    expect(openNow(new Date("2026-11-06T15:00:00Z")).open).toBe(true); // 10:00 AM Friday
    expect(openNow(new Date("2026-11-06T17:00:00Z"))).toMatchObject({ open: false, reason: "Shabbos" });
    expect(openNow(new Date("2026-11-07T20:00:00Z")).open).toBe(false); // Shabbos afternoon
    expect(openNow(new Date("2026-11-07T23:00:00Z")).open).toBe(true); // after tzeis
  });
});

describe("booking rules", () => {
  it("closed event days are refused", () => {
    expect(checkEventDate("2026-11-07")).toMatchObject({ ok: false, message: "We're closed on that day (Shabbos)." });
    expect(checkEventDate("2027-03-23").ok).toBe(false);
  });
  it("a Friday event: pickup moves to Sunday, flagged with the suggestion", () => {
    const c = checkEventDate("2026-11-06");
    expect(c.ok).toBe(true);
    expect(c.suggestedPickup).toBe("2026-11-08");
    expect(pickupDateFor("2026-11-06")).toBe("2026-11-08");
  });
  it("before a three-day Yom Tov + Shabbos, pickup is the first open day after", () => {
    expect(nextOpenDay("2026-09-12")).toBe("2026-09-14");
    expect(pickupDateFor("2026-10-02")).toBe("2026-10-05"); // Hoshana Rabbah -> after Shemini Atzeres/Simchas Torah
  });
  it("an ordinary weekday: pickup is the next day", () => {
    expect(pickupDateFor("2026-11-09")).toBe("2026-11-10");
  });
});

describe("admin toggles and owner overrides", () => {
  it("toggles flip each optional day type", () => {
    expect(dayInfo("2027-05-25", { ...S, closeLagBaomer: "yes" }).closed).toBe(true);
    expect(dayInfo("2027-03-23", { ...S, closePurim: "no" }).closed).toBe(false);
    expect(dayInfo("2026-09-29", { ...S, closeCholHamoed: "yes" }).closed).toBe(true);
    expect(dayInfo("2026-12-07", { ...S, closeChanukah: "yes" }).closed).toBe(true);
    expect(dayInfo("2026-09-14", { ...S, closeMinorFasts: "yes" }).closed).toBe(true);
  });
  it("owner overrides win (closed on a weekday, open on a toggled day)", () => {
    const s = { ...S, calendarOverrides: "2026-11-10 closed Family simcha\n2027-03-23 open" };
    expect(dayInfo("2026-11-10", s)).toMatchObject({ closed: true, reason: "Family simcha" });
    expect(dayInfo("2027-03-23", s).closed).toBe(false);
  });
  it("turning the calendar off leaves only owner overrides", () => {
    expect(dayInfo("2026-11-07", { ...S, calendarEnabled: "no" }).closed).toBe(false);
  });
  it("Hebrew dates show next to English dates", () => {
    expect(dayInfo("2026-11-06")).toMatchObject({ hebrew: "26th of Cheshvan, 5787", hebrewHe: "כ״ו חֶשְׁוָן תשפ״ז" });
  });
});
