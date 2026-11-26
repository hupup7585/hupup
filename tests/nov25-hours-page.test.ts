import { describe, expect, it } from "vitest";
import { hoursDefaults, officeOpenNow, websiteHoursLines } from "@/lib/business-hours";
import {
  addGroup,
  defaultHours,
  effectiveLine,
  lineOpen,
  loadHours,
  parseDateOverrides,
  parseWindows,
  recordedHoursWarnings,
  removeFromGroup,
  scheduleWords,
  setSchedule,
  type HoursData,
  type LineId,
} from "@/lib/hours-schedule";

/* The Hours page (Abraham, Nov 25, 2026, 4:50, 4:54 and 4:56 PM). Times are Eastern. */
const S = hoursDefaults();
const at = (iso: string) => new Date(iso);
const withHours = (data: HoursData) => ({ ...S, hoursSchedules: JSON.stringify(data) });
const opens = (id: LineId, iso: string, s = S) => lineOpen(loadHours(s), id, at(iso), s);

describe("customer service (4:50 PM): Sun-Thu 11 AM-2 PM and 7:30 PM-10 PM, Friday 11 AM-Chatzos", () => {
  it("Tuesday 1:30 PM rings, 3 PM after hours, 8 PM rings", () => {
    expect(opens("cs", "2026-12-01T18:30:00Z")).toBe(true);
    expect(opens("cs", "2026-12-01T20:00:00Z")).toBe(false);
    expect(opens("cs", "2026-12-02T01:00:00Z")).toBe(true);
  });
  it("Friday 11:30 AM rings (before chatzos), 1 PM after hours", () => {
    expect(opens("cs", "2026-11-27T16:30:00Z")).toBe(true);
    expect(opens("cs", "2026-11-27T18:00:00Z")).toBe(false);
  });
  it("Saturday night (Motzei Shabbes) closed; Shabbes closed", () => {
    expect(opens("cs", "2026-11-29T01:30:00Z")).toBe(false); // Sat 8:30 PM
    expect(opens("cs", "2026-11-28T17:00:00Z")).toBe(false);
  });
  it("a Chanukah weekday 8 PM rings (same hours as a weekday); 3 PM after hours", () => {
    expect(opens("cs", "2026-12-08T01:00:00Z")).toBe(true); // Mon Dec 7, 8 PM
    expect(opens("cs", "2026-12-07T20:00:00Z")).toBe(false);
  });
  it("one line of words, as Abraham wrote it for the website", () => {
    expect(scheduleWords(effectiveLine(loadHours(S), "cs").schedule)).toBe("Sunday-Thursday 11 AM-2 PM and 7:30 PM-10 PM; Friday 11 AM-Chatzos");
  });
});

describe("problems (key 4) and delivery (key 5): unchanged", () => {
  it("Sun-Thu 10 AM-7 PM; Chanukah and Chol Hamoed 9 AM-10:30 PM", () => {
    for (const id of ["problems", "delivery"] as const) {
      expect(opens(id, "2026-11-30T15:30:00Z")).toBe(true); // Mon 10:30 AM
      expect(opens(id, "2026-12-01T01:30:00Z")).toBe(false); // Mon 8:30 PM
      expect(opens(id, "2026-12-08T01:30:00Z")).toBe(true); // Chanukah Mon 8:30 PM
      expect(opens(id, "2026-12-08T03:45:00Z")).toBe(false); // 10:45 PM
      expect(opens(id, "2027-04-25T13:30:00Z")).toBe(true); // Chol Hamoed Sunday 9:30 AM EDT
    }
  });
});

describe("operator, schools and the website: the current business hours", () => {
  it("seeded from Business hours, so nothing changes until the Owner saves", () => {
    const d = defaultHours(S);
    expect(d.lines.operator.schedule).toEqual(d.lines.office.schedule);
    expect(websiteHoursLines(S)).toEqual(["Sunday: 11:30 AM - 7:00 PM", "Monday - Thursday: 10:30 AM - 7:00 PM", "Friday: 10:30 AM - Chatzos"]);
    expect(officeOpenNow(at("2026-12-08T03:00:00Z"), S)).toBe(true); // Chanukah 10 PM: the office's late hours stay
  });
});

describe("change hours in Admin: everything follows, no deploy", () => {
  it("customer service changed: ringing follows; website, key 7 and the office follow their own schedule", () => {
    const d = defaultHours(S);
    d.lines.cs.schedule.days["2"] = { closed: false, windows: [{ from: "15:00", to: "16:00" }] }; // Tuesday 3-4 PM
    d.lines.office.schedule.days["1"] = { closed: false, windows: [{ from: "09:00", to: "17:00" }] };
    const s = withHours(d);
    expect(opens("cs", "2026-12-01T20:00:00Z", s)).toBe(true); // Tue 3 PM now rings
    expect(opens("cs", "2026-12-01T18:30:00Z", s)).toBe(false); // Tue 1:30 PM no longer
    expect(websiteHoursLines(s)).toContain("Monday: 9:00 AM - 5:00 PM");
    expect(websiteHoursLines(s, true, true)).toContain("Monday: 9:00 AM - 5:00 PM"); // key 7 reads these lines
    expect(officeOpenNow(at("2026-11-30T14:30:00Z"), s)).toBe(true); // Monday 9:30 AM
  });
  it("a date set Closed (a day off), and a range with its own hours", () => {
    const d = defaultHours(S);
    d.lines.cs.schedule.overrides = parseDateOverrides("2026-12-01 closed Day off\n2026-12-02 to 2026-12-03 09:00-10:00").list;
    const s = withHours(d);
    expect(opens("cs", "2026-12-01T18:30:00Z", s)).toBe(false);
    expect(opens("cs", "2026-12-02T14:30:00Z", s)).toBe(true); // Wed 9:30 AM
    expect(opens("cs", "2026-12-03T18:30:00Z", s)).toBe(false); // Thu 1:30 PM
    expect(opens("cs", "2026-12-04T18:00:00Z", s)).toBe(false);
  });
  it("a bad saved value never breaks the line (falls back to the defaults)", () => {
    expect(opens("cs", "2026-12-01T18:30:00Z", { ...S, hoursSchedules: "{oops" })).toBe(true);
  });
});

describe("groups (4:56 PM)", () => {
  it("two lines in a group follow the group's hours and switch; taking one out keeps the hours", () => {
    let d = addGroup(defaultHours(S), "Rental help", ["problems", "delivery"]) as HoursData;
    expect(d.groups[0].members).toEqual(["problems", "delivery"]);
    const g = d.groups[0];
    const sched = JSON.parse(JSON.stringify(g.schedule));
    sched.days["1"] = { closed: false, windows: [{ from: "06:00", to: "07:00" }] };
    d = setSchedule(d, { group: g.id }, sched, true);
    for (const id of ["problems", "delivery"] as const) expect(opens(id, "2026-11-30T11:30:00Z", withHours(d))).toBe(true); // Mon 6:30 AM
    d = setSchedule(d, { line: "problems" }, sched, false); // editing a grouped line edits the group: switch off
    for (const id of ["problems", "delivery"] as const) expect(opens(id, "2026-11-30T11:30:00Z", withHours(d))).toBe(false);
    d = setSchedule(d, { group: g.id }, sched, true);
    d = removeFromGroup(d, g.id, "delivery");
    expect(d.groups[0].members).toEqual(["problems"]);
    expect(effectiveLine(d, "delivery").group).toBeNull();
    expect(opens("delivery", "2026-11-30T11:30:00Z", withHours(d))).toBe(true); // kept the group's hours
  });
  it("a line can be in only one group", () => {
    const d = addGroup(defaultHours(S), "A", ["cs", "operator"]) as HoursData;
    expect(addGroup(d, "B", ["cs", "schools"])).toHaveProperty("error");
  });
});

describe("the form and the red note", () => {
  it("windows in everyday formats; Friday may end at chatzos", () => {
    expect(parseWindows("11:00-14:00, 19:30-22:00")).toEqual([{ from: "11:00", to: "14:00" }, { from: "19:30", to: "22:00" }]);
    expect(parseWindows("11 AM - 2 PM and 7:30 PM - 10 PM")).toEqual([{ from: "11:00", to: "14:00" }, { from: "19:30", to: "22:00" }]);
    expect(parseWindows("11:00-Chatzos", true)).toEqual([{ from: "11:00", to: "chatzos" }]);
    expect(parseWindows("11:00-Chatzos")).toBeNull();
    expect(parseWindows("Closed")).toEqual([]);
    expect(parseWindows("lunch")).toBeNull();
  });
  // Nov 26, 2026: the red note compares the slot's own approved text and recording (tests/nov26-key7-shushan.test.ts)
  it("the recorded customer service hours line no longer matches: the red note", () => {
    expect(recordedHoursWarnings(defaultHours(S), { text: "Our customer service is open Sunday through Thursday, from 11 AM to 4 PM." })[0]).toMatch(/^The recorded hours line says 11 AM, 4 PM, but the Customer service hours/);
  });
});

describe("item 10 and 4:50 PM: the website's customer service line", () => {
  it("labeled Customer service, read from the customer service schedule; the same on a Chanukah date", async () => {
    const { customerServiceHours } = await import("@/lib/business-hours");
    expect(customerServiceHours(S)).toBe("Sunday-Thursday 11 AM-2 PM and 7:30 PM-10 PM; Friday 11 AM-Chatzos");
    // on a Chanukah weekday customer service rings its weekday hours, not the office's 10:30 PM late hours
    expect(opens("cs", "2026-12-07T21:30:00Z")).toBe(false); // 4:30 PM
    expect(opens("cs", "2026-12-08T03:15:00Z")).toBe(false); // 10:15 PM
    expect(officeOpenNow(at("2026-12-08T03:15:00Z"), S)).toBe(true);
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("Customer service</span>");
    expect(page).toContain("customerServiceHours(settings)");
  });
  it("the Admin Hours page: Owner only, Saved, live now., every line listed, groups", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/admin/(app)/hours/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    expect(page).toContain("Saved, live now.");
    expect(page).toContain("Make a group");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/hours", CalendarClock, "Hours", O]');
  });
});
