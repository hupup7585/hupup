import { addDaysISO, dayInfo, kinds, overrideFor, type CalendarSettings } from "@/lib/jewish-calendar";
import { defaultDayText, type HoursSettings } from "@/lib/business-hours";

export type HolidayRow = {
  date: string;
  hebrew: string;
  holiday: string;
  defaultOpen: boolean;
  defaultHours: string;
  choice: "default" | "open" | "closed";
  hours: string;
  note: string;
};

const HOLIDAY_KINDS = ["yomtov", "cholHamoed", "chanukah", "purim", "tishaBav", "minorFast", "lagBaomer"] as const;

/** One row for the admin list: the calendar's default plus the Owner's entry. */
export function rowFor(date: string, s: HoursSettings): HolidayRow {
  const info = dayInfo(date, { ...s, calendarOverrides: "" } as CalendarSettings);
  const d = defaultDayText(date, s);
  const own = overrideFor(date, s);
  // Staff screens: Hebrew-letter holiday names (Abraham); days without one keep the calendar name
  const holiday = info.namesYi.join(", ") || (info.closesAtLabel ? info.closesAtLabel.split(":")[0] : "") || "Regular day";
  return {
    date,
    hebrew: info.hebrew,
    holiday,
    defaultOpen: d.open,
    defaultHours: d.hours,
    choice: own ? (own.open ? "open" : "closed") : "default",
    hours: own?.hours ?? "",
    note: own?.note ?? "",
  };
}

/** Every holiday and Erev Yom Tov from `from` for `days` days, plus every day the Owner has an entry for. */
export function holidayRows(from: string, days: number, s: HoursSettings, ownDates: string[]): HolidayRow[] {
  const dates = new Set<string>(ownDates.filter((d) => d >= from));
  let d = from;
  for (let i = 0; i < days; i++, d = addDaysISO(d, 1)) {
    const k = kinds(d).kinds;
    const erevYomTov = dayInfo(d, { ...s, calendarOverrides: "" } as CalendarSettings).closesAtLabel?.startsWith("Erev Yom Tov");
    if (HOLIDAY_KINDS.some((x) => k.has(x)) || erevYomTov) dates.add(d);
  }
  return [...dates].sort().map((x) => rowFor(x, s));
}
