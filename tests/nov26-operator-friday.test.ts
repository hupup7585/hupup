import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calendarDefaults } from "@/lib/jewish-calendar";
import { OPERATOR_FRIDAY_SEASON, RING_KEY_LINE, defaultHours, effectiveLine, formatWindows, lineOpen, loadHours, parseWindows, scheduleWords, seasonAt, type HoursData } from "@/lib/hours-schedule";

/* The Operator's Friday closing by season (Abraham, Nov 26, 2026): opens 9:30 AM, closes 3:00 PM in winter (EST, from
 * the first Sunday of November) and 4:00 PM in summer (EDT, from the second Sunday of March), by the real New York
 * clock rules. Every other line keeps Chatzos on Friday. */
const cal = calendarDefaults();
/** The hours as saved today: the Operator's Friday 9:30 AM to Chatzos, everything else the defaults. */
const savedBefore = () => {
  const d = defaultHours({} as never);
  d.lines.operator.schedule.days["5"] = { closed: false, windows: [{ from: "09:30", to: "chatzos" }] };
  return JSON.stringify({ lines: d.lines, groups: [] });
};
const hours = (): HoursData => loadHours({ ...cal, hoursSchedules: savedBefore() } as never);
const open = (utc: string) => lineOpen(hours(), "operator", new Date(utc), cal);

describe("the Operator's Friday", () => {
  it("the saved Friday (9:30 AM to Chatzos) now ends at Season closing: 3 PM winter, 4 PM summer; opening unchanged", () => {
    const op = effectiveLine(hours(), "operator").schedule;
    expect(op.days["5"].windows).toEqual([{ from: "09:30", to: "season" }]);
    expect(op.fridaySeason).toEqual({ winter: "15:00", summer: "16:00" });
    expect(OPERATOR_FRIDAY_SEASON).toEqual({ winter: "15:00", summer: "16:00" });
    expect(formatWindows(op.days["5"].windows)).toBe("09:30-Season closing");
  });
  it("winter Friday (Nov 20, 2026, EST): 2:59 PM open, 3:00 PM closed; 9:29 AM closed, 9:30 AM open", () => {
    expect(open("2026-11-20T19:59:00Z")).toBe(true);
    expect(open("2026-11-20T20:00:00Z")).toBe(false);
    expect(open("2026-11-20T14:29:00Z")).toBe(false);
    expect(open("2026-11-20T14:30:00Z")).toBe(true);
    expect(open("2026-11-20T18:00:00Z")).toBe(true); // 1 PM, past Chatzos: still open
  });
  it("summer Friday (June 4, 2027, EDT): 3:59 PM open, 4:00 PM closed", () => {
    expect(open("2027-06-04T19:59:00Z")).toBe(true);
    expect(open("2027-06-04T20:00:00Z")).toBe(false);
    expect(open("2027-06-04T13:30:00Z")).toBe(true); // 9:30 AM
  });
  it("November clock change (Sunday Nov 1, 2026): Friday Oct 30 is summer (4 PM), Friday Nov 6 is winter (3 PM)", () => {
    expect(seasonAt(new Date("2026-10-30T16:00:00Z"))).toBe("summer");
    expect(open("2026-10-30T19:59:00Z")).toBe(true); // 3:59 PM EDT
    expect(open("2026-10-30T20:00:00Z")).toBe(false); // 4:00 PM EDT
    expect(seasonAt(new Date("2026-11-06T16:00:00Z"))).toBe("winter");
    expect(open("2026-11-06T19:59:00Z")).toBe(true); // 2:59 PM EST
    expect(open("2026-11-06T20:00:00Z")).toBe(false); // 3:00 PM EST
    // the change itself: 1:59 AM EDT Sunday is summer, an hour later (1:00 AM EST again) winter
    expect(seasonAt(new Date("2026-11-01T05:59:00Z"))).toBe("summer");
    expect(seasonAt(new Date("2026-11-01T06:00:00Z"))).toBe("winter");
  });
  it("March clock change (Sunday March 14, 2027): Friday March 12 is winter (3 PM), Friday March 19 is summer (4 PM)", () => {
    expect(seasonAt(new Date("2027-03-12T16:00:00Z"))).toBe("winter");
    expect(open("2027-03-12T19:59:00Z")).toBe(true); // 2:59 PM EST
    expect(open("2027-03-12T20:00:00Z")).toBe(false); // 3:00 PM EST
    expect(seasonAt(new Date("2027-03-19T16:00:00Z"))).toBe("summer");
    expect(open("2027-03-19T19:59:00Z")).toBe(true); // 3:59 PM EDT
    expect(open("2027-03-19T20:00:00Z")).toBe(false); // 4:00 PM EDT
    expect(seasonAt(new Date("2027-03-14T06:59:00Z"))).toBe("winter"); // 1:59 AM EST
    expect(seasonAt(new Date("2027-03-14T07:00:00Z"))).toBe("summer"); // 3:00 AM EDT
  });
  it("the real time zone rules, not fixed dates: 2027's change is the first Sunday of November (Nov 7)", () => {
    expect(seasonAt(new Date("2027-11-05T16:00:00Z"))).toBe("summer"); // Friday Nov 5, 2027: still daylight time
    expect(seasonAt(new Date("2027-11-12T16:00:00Z"))).toBe("winter");
  });
  it("the Owner's new times are used; a later save keeps the Owner's choice", () => {
    const h = hours();
    h.lines.operator.schedule.fridaySeason = { winter: "14:30", summer: "17:00" };
    const s = { ...cal, hoursSchedules: JSON.stringify(h) } as never;
    expect(lineOpen(loadHours(s), "operator", new Date("2026-11-20T19:29:00Z"), cal)).toBe(true); // 2:29 PM
    expect(lineOpen(loadHours(s), "operator", new Date("2026-11-20T19:30:00Z"), cal)).toBe(false); // 2:30 PM
    expect(lineOpen(loadHours(s), "operator", new Date("2027-06-04T20:59:00Z"), cal)).toBe(true); // 4:59 PM
    // the Owner sets the Operator's Friday back to Chatzos: kept (the change is made once)
    h.lines.operator.schedule.days["5"].windows = [{ from: "09:30", to: "chatzos" }];
    expect(effectiveLine(loadHours({ ...cal, hoursSchedules: JSON.stringify(h) } as never), "operator").schedule.days["5"].windows[0].to).toBe("chatzos");
  });
  it("Saturday, Sunday to Thursday unchanged for the Operator", () => {
    const before = defaultHours({} as never).lines.operator.schedule;
    const after = effectiveLine(hours(), "operator").schedule;
    for (const d of ["0", "1", "2", "3", "4", "6"] as const) expect(after.days[d]).toEqual(before.days[d]);
    expect(after.chanukah).toEqual(before.chanukah);
    expect(after.cholHamoed).toEqual(before.cholHamoed);
  });
});

describe("every other line keeps Chatzos on Friday", () => {
  it("customer service, problems, delivery, schools and office: Friday ends at Chatzos, closed at 1 PM", () => {
    const h = hours();
    for (const id of ["cs", "problems", "delivery", "schools", "office"] as const) {
      const sch = effectiveLine(h, id).schedule;
      expect(sch.fridaySeason).toBeUndefined();
      expect(sch.days["5"].windows.at(-1)!.to).toBe("chatzos");
      if (id !== "office") expect(lineOpen(h, id, new Date("2026-11-20T18:00:00Z"), cal)).toBe(false); // 1 PM, past Chatzos
    }
  });
});

describe("Admin and the phone", () => {
  it("the Hours page: Winter closing and Summer closing fields, which one is in effect today; Friday may end at Season closing", () => {
    const page = readFileSync("src/app/admin/(app)/hours/page.tsx", "utf8");
    expect(page).toContain("Winter closing");
    expect(page).toContain("Summer closing");
    expect(page).toContain("In effect today");
    expect(page).toContain("seasonAt(new Date())");
    const actions = readFileSync("src/app/admin/(app)/hours/actions.ts", "utf8");
    expect(actions).toContain('fd.get("season") === "1"');
    expect(parseWindows("09:30-Season closing", true, true)).toEqual([{ from: "09:30", to: "season" }]);
    expect(parseWindows("09:30-Season closing", true, false)).toBeNull(); // only where the season closing is set
    expect(parseWindows("00:00-3 PM")?.[0].to).toBe("15:00");
    expect(scheduleWords(effectiveLine(hours(), "operator").schedule)).toContain("Friday 9:30 AM-the season's closing time");
  });
  it("key 0 and every operator transfer use the line's hours (the Hours page), so the season's closing time", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toMatch(/RING_KEY_LINE\[k\]/);
    expect(flow).toContain("lineOpen(hours, line, at, settings)");
    expect(RING_KEY_LINE["0"]).toBe("operator"); // main menu key 0 (the operator ring line)
  });
});
