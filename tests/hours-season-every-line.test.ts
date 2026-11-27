import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calendarDefaults } from "@/lib/jewish-calendar";
import { defaultHours, lineOpen, loadHours, parseWindows } from "@/lib/hours-schedule";

/* Abraham, Nov 26, 2026, 14:04: Operator (key 0), Problems during a rental (key 4) and Delivery and pickup (key 5) all
 * close on Friday together, 3 PM in winter and 4 PM in summer. Every department in Hours gets the winter/summer
 * Friday closing option (not the website and office hours: the website would show new words). */
const cal = calendarDefaults();
const withSeason = () => {
  const d = defaultHours({} as never);
  for (const id of ["problems", "delivery", "operator"] as const) {
    d.lines[id].schedule.days["5"] = { closed: false, windows: [{ from: "09:30", to: "season" }] };
    d.lines[id].schedule.fridaySeason = { winter: "15:00", summer: "16:00" };
  }
  return loadHours({ ...cal, hoursSchedules: JSON.stringify({ lines: d.lines, groups: [], operatorFridaySeason: true }) } as never);
};

describe("winter and summer Friday closing for every department", () => {
  for (const id of ["problems", "delivery", "operator"] as const) {
    it(`${id}: winter Friday 2:59 PM open, 3:00 PM closed; summer Friday 3:59 PM open, 4:00 PM closed`, () => {
      const h = withSeason();
      expect(lineOpen(h, id, new Date("2026-11-20T19:59:00Z"), cal)).toBe(true);
      expect(lineOpen(h, id, new Date("2026-11-20T20:00:00Z"), cal)).toBe(false);
      expect(lineOpen(h, id, new Date("2027-06-04T19:59:00Z"), cal)).toBe(true);
      expect(lineOpen(h, id, new Date("2027-06-04T20:00:00Z"), cal)).toBe(false);
    });
  }
  it("a Friday that ends at Season closing is accepted once the season box is ticked, refused without it", () => {
    expect(parseWindows("09:30-Season closing", true, true)).toEqual([{ from: "09:30", to: "season" }]);
    expect(parseWindows("09:30-Season closing", true, false)).toBeNull();
  });
  it("the Hours page offers it on every department, the website and office hours too (Abraham, Nov 26, 2026), with the explanation", () => {
    const page = readFileSync("src/app/admin/(app)/hours/page.tsx", "utf8");
    expect(page).not.toContain('seasonAllowed={id !== "office"}');
    expect(page).toContain("{seasonAllowed && <FridaySeasonFields schedule={schedule} />}");
    expect(page).toContain('name="season" value="1" defaultChecked={Boolean(schedule.fridaySeason)}');
    for (const s of ["What it does:", "How to use it:", "If you change it:"]) expect(page).toContain(s);
    const actions = readFileSync("src/app/admin/(app)/hours/actions.ts", "utf8");
    expect(actions).toContain('const season = fd.get("season") === "1";');
  });
  it("lines without the box keep Chatzos (customer service is unchanged)", () => {
    const h = withSeason();
    expect(h.lines.cs.schedule.fridaySeason).toBeUndefined();
  });
});

describe("the website shows the season's Friday time, never new words (Nov 26, 2026)", () => {
  it("a season Friday on the office hours prints the time in effect", async () => {
    const { officeLines, OPERATOR_FRIDAY_SEASON } = await import("@/lib/hours-schedule");
    const day = (from: string, to: string) => ({ closed: false, windows: [{ from, to }] });
    const sch = { days: { "0": day("10:00", "19:00"), "1": day("10:00", "19:00"), "2": day("10:00", "19:00"), "3": day("10:00", "19:00"), "4": day("10:00", "19:00"), "5": day("10:00", "season"), "6": { closed: true, windows: [] } }, chanukah: {}, cholHamoed: {}, overrides: [], fridaySeason: { ...OPERATOR_FRIDAY_SEASON } } as never;
    const winter = officeLines(sch, new Date("2026-12-04T15:00:00Z")).join(" | ");
    const summer = officeLines(sch, new Date("2027-06-18T15:00:00Z")).join(" | ");
    expect(winter).toContain("Friday: 10:00 AM - 3:00 PM");
    expect(summer).toContain("Friday: 10:00 AM - 4:00 PM");
    expect(winter + summer).not.toContain("Season closing");
  });
});
