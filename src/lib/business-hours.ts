import type { Settings } from "@/lib/settings";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { TIME_ZONE, addDaysISO, dayInfo, localISO, type CalendarSettings } from "@/lib/jewish-calendar";
import { HDate, HebrewCalendar, flags } from "@hebcal/core";

/**
 * Office hours (walk-ins and live calls), Abraham 2026-11-06. Eastern time. Uses the Jewish calendar for closed
 * days, Erev Shabbos/Yom Tov early close and Motzei Shabbos. The automated phone system books 24/7 regardless.
 */

export type HoursSettings = CalendarSettings &
  Pick<Settings, "hoursMonThu" | "hoursFridayOpen" | "hoursSunday" | "hoursMotzeiOpen" | "hoursMotzeiCloseWinter" | "hoursMotzeiCloseSummer" | "hoursMotzeiSeason" | "hoursCholHamoed" | "hoursWebsiteNote">;

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
  const [y, m, d] = iso.split("-").map(Number);
  return (HebrewCalendar.getHolidaysOnDate(new HDate(new Date(y, m - 1, d, 12)), false) ?? []).some((e) => e.getFlags() & flags.CHOL_HAMOED);
}
function inDST(at: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value;
  return name === "EDT";
}
function motzeiCloseMinutes(at: Date, s: HoursSettings): number {
  const summer = s.hoursMotzeiSeason === "dst" ? inDST(at) : s.hoursMotzeiSeason === "summer";
  return mins(summer ? s.hoursMotzeiCloseSummer : s.hoursMotzeiCloseWinter) ?? 23 * 60 + 30;
}

/** Is the office open (walk-ins and live calls) at this moment? */
export function officeOpenNow(at: Date = new Date(), s: HoursSettings = hoursDefaults()): boolean {
  const iso = localISO(at);
  const now = localMinutes(at);
  const today = dayInfo(iso, s);

  // After midnight on Sunday: the end of a Motzei Shabbos that runs past 12:00 AM (summer 12:30 AM).
  const yesterday = dayInfo(addDaysISO(iso, -1), s);
  const close = motzeiCloseMinutes(at, s);
  if (yesterday.reopensAt && close < 6 * 60 && now < close) return true;

  if (today.closed) {
    if (!today.reopensAt || at < today.reopensAt) return false;
    // Motzei Shabbos / Motzei Yom Tov
    const open = s.hoursMotzeiOpen === "tzeis" ? null : mins(s.hoursMotzeiOpen);
    if (open !== null && now < open) return false;
    return close >= 6 * 60 ? now < close : true; // past-midnight close handled above
  }

  let window: [number, number] | null;
  if (isCholHamoed(iso)) window = range(s.hoursCholHamoed);
  else if (dow(iso) === 0) window = range(s.hoursSunday);
  else if (dow(iso) === 5) window = [mins(s.hoursFridayOpen) ?? 630, 24 * 60];
  else window = range(s.hoursMonThu);
  if (!window || now < window[0] || now >= window[1]) return false;
  if (today.closesAt && at >= today.closesAt) return false; // Erev Shabbos / Erev Yom Tov
  return true;
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

/** Hours as lines for the website. */
export function hoursLines(s: HoursSettings = hoursDefaults()): string[] {
  const motzeiOpen = s.hoursMotzeiOpen === "tzeis" ? "after Shabbos ends" : `from ${ampm(s.hoursMotzeiOpen)}`;
  return [
    `Monday to Thursday: ${span(s.hoursMonThu)}`,
    `Friday: from ${ampm(s.hoursFridayOpen)} until midday (chatzos)`,
    "Saturday (Shabbos): Closed",
    `Saturday night (Motzei Shabbos): ${motzeiOpen} until ${ampm(s.hoursMotzeiCloseWinter)} in winter, ${ampm(s.hoursMotzeiCloseSummer)} in summer`,
    `Sunday: ${span(s.hoursSunday)}`,
    `Chol Hamoed: ${span(s.hoursCholHamoed)}`,
    "Closed on Shabbos and Yom Tov.",
  ];
}
