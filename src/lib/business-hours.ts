import type { Settings } from "@/lib/settings";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { TIME_ZONE, addDaysISO, dayInfo, localISO, overrideFor, type CalendarSettings } from "@/lib/jewish-calendar";
import { fixedFromISO } from "@/lib/hup-calendar/hebrew-date";
import { holidaysOn } from "@/lib/hup-calendar/holidays";

/**
 * Office hours (walk-ins and live calls), Abraham 2026-11-06. Eastern time. Uses the Jewish calendar for closed
 * days, Erev Shabbos/Yom Tov early close and Motzei Shabbos. The automated phone system books 24/7 regardless.
 */

export type HoursSettings = CalendarSettings &
  Pick<Settings, "hoursMonThu" | "hoursFridayOpen" | "hoursSunday" | "hoursMotzeiOpen" | "hoursMotzeiCloseWinter" | "hoursMotzeiCloseSummer" | "hoursMotzeiSeason" | "hoursCholHamoed" | "hoursChanukah" | "hoursWebsiteNote">;

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

  // The Owner's own hours for this day (admin "Holidays & hours") win over the calendar's defaults.
  const own = overrideFor(iso, s);
  if (own?.open && own.hours) {
    const w = range(own.hours);
    if (w) return now >= w[0] && now < w[1];
  }

  if (today.closed) {
    if (!today.reopensAt || at < today.reopensAt) return false;
    // Motzei Shabbos / Motzei Yom Tov: opens N minutes after Shabbos ends ("tzeis+120"), at tzeis, or at a set time.
    const after = s.hoursMotzeiOpen.trim().match(/^tzeis(?:\+(\d+))?$/);
    if (after) {
      if (at.getTime() < today.reopensAt.getTime() + Number(after[1] ?? 0) * 60_000) return false;
    } else {
      const open = mins(s.hoursMotzeiOpen);
      if (open !== null && now < open) return false;
    }
    return close >= 6 * 60 ? now < close : true; // past-midnight close handled above
  }

  let window: [number, number] | null;
  const late = lateWindow(iso);
  if (late === "cholHamoed") window = range(s.hoursCholHamoed);
  else if (late === "chanukah") window = range(s.hoursChanukah);
  else if (dow(iso) === 0) window = range(s.hoursSunday);
  else if (dow(iso) === 5) window = [mins(s.hoursFridayOpen) ?? 630, 24 * 60];
  else window = range(s.hoursMonThu);
  if (!window || now < window[0] || now >= window[1]) return false;
  if (today.closesAt && at >= today.closesAt) return false; // Erev Shabbos / Erev Yom Tov
  return true;
}

/**
 * For the hotline's "open late today" line: Chol Hamoed or Chanukah when that day's late hours apply and the office
 * is open right now. Never on a day that closes early (Erev Shabbos / Erev Yom Tov).
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

/** Hours as lines for the website. */
export function hoursLines(s: HoursSettings = hoursDefaults()): string[] {
  const after = s.hoursMotzeiOpen.trim().match(/^tzeis(?:\+(\d+))?$/);
  const n = after ? Number(after[1] ?? 0) : 0;
  const motzeiOpen = after ? (n ? `from ${n % 60 === 0 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} minutes`} after Shabbos ends` : "when Shabbos ends") : `from ${ampm(s.hoursMotzeiOpen)}`;
  return [
    `Monday to Thursday: ${span(s.hoursMonThu)}`,
    `Friday: from ${ampm(s.hoursFridayOpen)} until midday (chatzos)`,
    "Saturday (Shabbos): Closed",
    `Saturday night (Motzei Shabbos): ${motzeiOpen} until ${ampm(s.hoursMotzeiCloseWinter)} in winter, ${ampm(s.hoursMotzeiCloseSummer)} in summer`,
    `Sunday: ${span(s.hoursSunday)}`,
    `Chol Hamoed: ${span(s.hoursCholHamoed)}`,
    `Chanukah: ${span(s.hoursChanukah)}`,
    "Closed on Shabbos and Yom Tov.",
  ];
}

/** Today's office hours as one line, e.g. "Today: 10:30 AM to 7:00 PM" or "Closed today (Shabbos). Open tonight from 7:22 PM to 11:30 PM." */
export function todayHours(at: Date = new Date(), s: HoursSettings = hoursDefaults()): string {
  const iso = localISO(at);
  const info = dayInfo(iso, s);
  const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
  if (info.closed) {
    if (!info.reopensAt) return `Closed today (${info.reason}).`;
    const after = s.hoursMotzeiOpen.trim().match(/^tzeis(?:\+(\d+))?$/);
    const opens = after ? new Date(info.reopensAt.getTime() + Number(after[1] ?? 0) * 60_000) : null;
    const summer = s.hoursMotzeiSeason === "dst" ? inDST(at) : s.hoursMotzeiSeason === "summer";
    const close = ampm(summer ? s.hoursMotzeiCloseSummer : s.hoursMotzeiCloseWinter);
    return `Closed today (${info.reason}). Open tonight${opens ? ` from ${t(opens)}` : ""} until ${close}.`;
  }
  if (isCholHamoed(iso)) return `Today (Chol Hamoed): ${span(s.hoursCholHamoed)}`;
  if (dow(iso) === 0) return `Today: ${span(s.hoursSunday)}`;
  if (info.closesAt) return `Today: ${ampm(s.hoursFridayOpen)} to ${t(info.closesAt)} (${dow(iso) === 5 ? "Erev Shabbos" : "Erev Yom Tov"})`;
  if (dow(iso) === 5) return `Today: from ${ampm(s.hoursFridayOpen)}`;
  return `Today: ${span(s.hoursMonThu)}`;
}
