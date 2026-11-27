import type { Settings } from "@/lib/settings";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { TIME_ZONE, dayInfo, localISO, overrideFor, type CalendarSettings } from "@/lib/jewish-calendar";
import { fixedFromISO } from "@/lib/hup-calendar/hebrew-date";
import { holidaysOn } from "@/lib/hup-calendar/holidays";
import { effectiveLine, loadHours, officeLines, scheduleOpenNow, scheduleWords } from "@/lib/hours-schedule";

/**
 * Office hours (walk-ins and live calls), Abraham 2026-11-06. Eastern time. Uses the Jewish calendar for closed
 * days and the Erev Shabbes/Yom Tov early close (closed Motzei Shabbes and Motzei Yom Tov, Nov 25, 2026). The automated phone system books 24/7 regardless.
 */

export type HoursSettings = CalendarSettings &
  Pick<Settings, "hoursSchedules" | "hoursMonThu" | "hoursFridayOpen" | "hoursSunday" | "hoursMotzeiOpen" | "hoursMotzeiCloseWinter" | "hoursMotzeiCloseSummer" | "hoursMotzeiSeason" | "hoursCholHamoed" | "hoursChanukah" | "hoursWebsiteNote">;

export function hoursDefaults(): HoursSettings {
  return { ...SETTING_DEFAULTS };
}

/** Minutes since local midnight, in Eastern time. */
function localMinutes(at: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  return h * 60 + m;
}
function mins(hhmm: string): number | null {
  const r = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  return r ? Number(r[1]) * 60 + Number(r[2]) : null;
}
function range(r: string): [number, number] | null {
  const [a, b] = r.split("-");
  const x = mins(a ?? ""), y = mins(b ?? "");
  return x === null || y === null ? null : [x, y];
}
function dow(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function isCholHamoed(iso: string) {
  return holidaysOn(fixedFromISO(iso)).some((e) => e.flags.includes("CHOL_HAMOED"));
}
function isChanukah(iso: string) {
  return holidaysOn(fixedFromISO(iso)).some((e) => e.key.startsWith("Chanukah"));
}
/** Which late-hours window applies on this date (Friday of Chanukah keeps Friday hours: closes at chatzos). */
function lateWindow(iso: string): "cholHamoed" | "chanukah" | null {
  if (isCholHamoed(iso)) return "cholHamoed";
  if (isChanukah(iso) && dow(iso) !== 5 && dow(iso) !== 6) return "chanukah";
  return null;
}
/**
 * Is the office open (walk-ins and live calls) at this moment? Read from the Hours page (Abraham, Nov 25, 2026, 4:54 PM):
 * the "Website and office hours" schedule (or its group). The Owner's own day on Business hours & holidays still wins:
 * a closed day is closed, and a day with its own hours uses them.
 */
export function officeOpenNow(at: Date = new Date(), s: HoursSettings = hoursDefaults()): boolean {
  const iso = localISO(at);
  const own = overrideFor(iso, s);
  if (own?.open && own.hours) {
    const w = range(own.hours);
    if (w) {
      const now = localMinutes(at);
      return now >= w[0] && now < w[1];
    }
  }
  return scheduleOpenNow(effectiveLine(loadHours(s), "office").schedule, at, s);
}

/**
 * For the hotline's "open late today" line: Chol Hamoed or Chanukah when that day's late hours apply and the office
 * is open right now. Never on a day that closes early (Erev Shabbes / Erev Yom Tov).
 */
export function lateHoursToday(at: Date = new Date(), s: HoursSettings = hoursDefaults()): "cholHamoed" | "chanukah" | null {
  const iso = localISO(at);
  const late = lateWindow(iso);
  if (!late || overrideFor(iso, s) || dayInfo(iso, s).closesAt || !officeOpenNow(at, s)) return null;
  return late;
}

function ampm(hhmm: string) {
  const m = mins(hhmm);
  if (m === null) return hhmm;
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const span = (r: string) => {
  const [a, b] = r.split("-");
  return `${ampm(a)} to ${ampm(b)}`;
};

/**
 * The calendar's default for a day, in words, for the admin "Holidays & hours" list (ignores the Owner's entries),
 * e.g. "Closed (Pesach I)", "10:30 AM to 10:30 PM", "10:30 AM until chatzos (12:56 PM)".
 */
export function defaultDayText(iso: string, s: HoursSettings = hoursDefaults()): { open: boolean; hours: string } {
  const base = { ...s, calendarOverrides: "" };
  const info = dayInfo(iso, base);
  if (info.closed) return { open: false, hours: `Closed (${info.reason})` };
  const late = lateWindow(iso);
  const span24 = late === "cholHamoed" ? s.hoursCholHamoed : late === "chanukah" ? s.hoursChanukah : dow(iso) === 0 ? s.hoursSunday : dow(iso) === 5 ? null : s.hoursMonThu;
  const start = span24 ? span24.split("-")[0] : s.hoursFridayOpen;
  if (info.closesAt) {
    const t = info.closesAt.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
    return { open: true, hours: `${ampm(start)} until ${/candle/.test(info.closesAtLabel ?? "") ? "candle lighting" : "chatzos"} (${t})` };
  }
  return { open: true, hours: span24 ? span(span24) : `${ampm(start)} until chatzos` };
}

/**
 * Spelling (Abraham, Nov 19, 2026): the website uses the standard spelling "Motzei Shabbos"; the hotline reads
 * "Mutze Shabbes", the way people say it in this community. `mutze` = true only for the phone.
 */
export const siteMutze = (_env: Record<string, string | undefined> = process.env) => false;

/** Hours as lines for the website. */
export function hoursLines(s: HoursSettings = hoursDefaults(), mutze: boolean = siteMutze()): string[] {
  void mutze;
  return [
    `Monday to Thursday: ${span(s.hoursMonThu)}`,
    `Friday: from ${ampm(s.hoursFridayOpen)} until midday (chatzos)`,
    "Saturday (Shabbes): Closed",
    `Sunday: ${span(s.hoursSunday)}`,
    `Chol Hamoed: ${span(s.hoursCholHamoed)}`,
    `Chanukah: ${span(s.hoursChanukah)}`,
    "Closed on Shabbes and Yom Tov.",
  ];
}

/**
 * The website "Our Hours" card (Abraham): built from the same Admin Settings hours the phone line uses, so the two
 * can never differ. Same layout as Abraham's list: "Day: hours", no Motzei line.
 */
export function websiteHoursLines(s: HoursSettings = hoursDefaults(), mutze: boolean = siteMutze(), shabbesLine = false): string[] {
  const dash = (r: string) => {
    const [a, b] = r.split("-");
    return `${ampm(a)} - ${ampm(b)}`;
  };
  void mutze;
  void dash;
  return [
    // From the Hours page (Nov 25, 2026, 4:54 PM): the website and office hours schedule, grouped the same way as before
    ...officeLines(effectiveLine(loadHours(s), "office").schedule),
    // Abraham, Nov 19, 2026: "Take off the line, Shabbes closed" on the website (the phone's key 7 still says it)
    ...(shabbesLine ? ["Shabbes: Closed"] : []),
    // Abraham, Nov 25, 2026, 3:44 PM: closed on Motzei Shabbes; no Motzei line on the website or key 7
  ];
}

/** Today's office hours as one line, e.g. "Today: 10:30 AM to 7:00 PM" or "Closed today (Shabbes)." */
export function todayHours(at: Date = new Date(), s: HoursSettings = hoursDefaults()): string {
  const iso = localISO(at);
  const info = dayInfo(iso, s);
  const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
  if (info.closed) return `Closed today (${info.reason}).`; // no Motzei hours (Abraham, Nov 25, 2026, 3:44 PM)
  if (isCholHamoed(iso)) return `Today (Chol Hamoed): ${span(s.hoursCholHamoed)}`;
  if (dow(iso) === 0) return `Today: ${span(s.hoursSunday)}`;
  if (info.closesAt) return `Today: ${ampm(s.hoursFridayOpen)} to ${t(info.closesAt)} (${dow(iso) === 5 ? "Erev Shabbes" : "Erev Yom Tov"})`;
  if (dow(iso) === 5) return `Today: from ${ampm(s.hoursFridayOpen)}`;
  return `Today: ${span(s.hoursMonThu)}`;
}

/**
 * Customer service hours for the website (Abraham, Nov 25, 2026, item 10 and 4:50 PM): from the Hours page, the same
 * schedule the phone rings by, e.g. "Sunday-Thursday 11 AM-2 PM and 7:30 PM-10 PM; Friday 11 AM-Chatzos". The same
 * on Chanukah and Chol Hamoed (customer service keeps its weekday hours then).
 */
export function customerServiceHours(s: HoursSettings = hoursDefaults()): string {
  return scheduleWords(effectiveLine(loadHours(s), "cs").schedule) || "Closed";
}

const SCHEMA_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type OpeningHoursSpec = { "@type": "OpeningHoursSpecification"; dayOfWeek: string | string[]; opens: string; closes: string };

/**
 * The weekly hours for search engines (LocalBusiness schema), from the same Hours page schedule the website's Our Hours
 * list shows (Nov 25, 2026), so the two never disagree. Only fixed clock times are listed: Friday closes at Chatzos (or
 * by season), which changes every week, so it is left to the Hours section; Shabbes is closed. Days with the same
 * times are grouped.
 */
export function websiteOpeningHoursSpec(s: HoursSettings = hoursDefaults()): OpeningHoursSpec[] {
  const sch = effectiveLine(loadHours(s), "office").schedule;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  const byTimes = new Map<string, string[]>();
  for (let d = 0; d < 7; d++) {
    const day = sch.days[String(d) as "0"];
    if (!day || day.closed) continue;
    for (const w of day.windows) {
      if (!clock.test(w.from.trim()) || !clock.test(w.to.trim())) continue; // Chatzos and seasonal closes are not fixed times
      const key = `${w.from.trim()}-${w.to.trim()}`;
      byTimes.set(key, [...(byTimes.get(key) ?? []), SCHEMA_DAYS[d]]);
    }
  }
  return [...byTimes].map(([key, days]) => {
    const [opens, closes] = key.split("-");
    return { "@type": "OpeningHoursSpecification", dayOfWeek: days.length === 1 ? days[0] : days, opens, closes };
  });
}
