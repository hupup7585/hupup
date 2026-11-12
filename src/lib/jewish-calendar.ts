import { fixedFromISO, hebrewFromISO } from "@/lib/hup-calendar/hebrew-date";
import { holidaysOn, type Holiday } from "@/lib/hup-calendar/holidays";
import { renderEnglish, renderHebrew } from "@/lib/hup-calendar/names";
import { zmanim as solarTimes } from "@/lib/hup-calendar/zmanim";
import type { Settings } from "@/lib/settings";
import { SETTING_DEFAULTS } from "@/lib/settings";

/**
 * Jewish calendar open/closed rules (Abraham, 2026-11-06), shared by the POS, the hotline and booking checks.
 * Hup Up's own calendar (src/lib/hup-calendar, written in-house, no outside library). Diaspora (two-day Yom Tov).
 * Zmanim for Monroe / Kiryas Joel, NY.
 *
 * Closed all day: every Shabbos and Yom Tov (Rosh Hashanah, Yom Kippur, Sukkos 1-2, Shemini Atzeres, Simchas
 * Torah, Pesach 1-2 and 7-8, Shavuos 1-2). Open: Chol Hamoed, Chanukah. Admin toggles (defaults): Purim closed,
 * Tisha B'Av closed, minor fasts open, Lag Ba'Omer open. Erev Shabbos and Erev Yom Tov close at chatzos (or at
 * candle lighting if set). Reopen after Shabbos / Yom Tov at tzeis (8.5 degrees) or N minutes after sunset.
 * Owner overrides by date win over everything.
 */

export type CalendarSettings = Pick<
  Settings,
  | "calendarEnabled"
  | "calendarLatitude"
  | "calendarLongitude"
  | "erevShabbosClose"
  | "erevYomTovClose"
  | "candleLightingMinutes"
  | "reopenAfter"
  | "closeCholHamoed"
  | "closeChanukah"
  | "closePurim"
  | "closeTishaBav"
  | "closeMinorFasts"
  | "closeLagBaomer"
  | "calendarOverrides"
>;

export const TIME_ZONE = "America/New_York";
const yes = (v: string) => v.trim().toLowerCase() === "yes";

export function calendarDefaults(): CalendarSettings {
  return { ...SETTING_DEFAULTS };
}

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
export function addDaysISO(iso: string, n: number) {
  const { y, m, d } = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
/** The calendar date in Kiryas Joel for an instant. */
export function localISO(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
function weekday(iso: string) {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 6 = Saturday
}

function place(s: CalendarSettings) {
  return { latitude: Number(s.calendarLatitude) || 41.3407, longitude: Number(s.calendarLongitude) || -74.1679 };
}
/** Sunrise, sunset, chatzos and tzeis for a date at the business's location. */
function zmanim(iso: string, s: CalendarSettings) {
  const z = solarTimes(iso, place(s));
  return { sunset: z.sunset, chatzot: z.chatzos, tzeit: z.tzeis };
}

function events(iso: string): Holiday[] {
  return holidaysOn(fixedFromISO(iso));
}

export type Kind = "shabbos" | "yomtov" | "cholHamoed" | "chanukah" | "purim" | "tishaBav" | "minorFast" | "lagBaomer";

/**
 * Holiday names for one day, three ways, same order: `names` (calendar names, e.g. "Sukkos I"), `namesEn` (Abraham's
 * Ashkenazi English names for the phone line, e.g. "Sukkos"), `namesYi` (Hebrew-letter names for staff screens).
 */
export function kinds(iso: string): { kinds: Set<Kind>; names: string[]; namesEn: string[]; namesYi: string[] } {
  const k = new Set<Kind>();
  const names: string[] = [];
  const namesEn: string[] = [];
  const namesYi: string[] = [];
  if (weekday(iso) === 6) {
    k.add("shabbos");
    names.push("Shabbos");
    namesEn.push("Shabbos");
    namesYi.push("שבת");
  }
  for (const e of events(iso)) {
    const f = new Set(e.flags);
    const key = e.key;
    if (f.has("CHAG")) k.add("yomtov");
    else if (f.has("CHOL_HAMOED")) k.add("cholHamoed");
    if (key.startsWith("Chanukah")) k.add("chanukah");
    if (key === "Purim") k.add("purim");
    if (key.startsWith("Tish'a B'Av")) k.add("tishaBav");
    if (f.has("MINOR_FAST") && key !== "Ta'anit Bechorot") k.add("minorFast");
    if (key === "Lag BaOmer") k.add("lagBaomer");
    if (f.has("CHAG") || f.has("CHOL_HAMOED") || f.has("MINOR_FAST") || f.has("MAJOR_FAST") || f.has("MINOR_HOLIDAY") || f.has("EREV") || key.startsWith("Chanukah") || key === "Purim" || key === "Lag BaOmer") {
      names.push(e.name);
      namesEn.push(e.proposedEn ?? e.name);
      namesYi.push(e.proposedYi ?? e.name);
    }
  }
  return { kinds: k, names, namesEn, namesYi };
}

/** The Owner's entry for one day (admin "Holidays & hours"): Open or Closed, optional hours, notes. */
export type DayOverride = { open: boolean; hours: string | null; note: string };

/**
 * Owner overrides, one line per day: "2027-04-25 open 10:30-22:30 Notes" or "2027-01-01 closed Notes".
 * Hours (24-hour "HH:MM-HH:MM") are optional and only apply to open days. Older lines without hours still work.
 */
export function parseOverrides(text: string): Map<string, DayOverride> {
  const m = new Map<string, DayOverride>();
  for (const line of text.split("\n")) {
    const r = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(open|closed)\b(?:\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2})(?=\s|$))?\s*(.*)$/i);
    if (r) m.set(r[1], { open: r[2].toLowerCase() === "open", hours: r[2].toLowerCase() === "open" ? r[3] ?? null : null, note: r[4] });
  }
  return m;
}

export function formatOverrides(m: Map<string, DayOverride>): string {
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, o]) => [d, o.open ? "open" : "closed", o.open && o.hours ? o.hours : "", o.note.replace(/\s+/g, " ").trim()].filter(Boolean).join(" "))
    .join("\n");
}

function overrides(s: CalendarSettings): Map<string, DayOverride> {
  return parseOverrides(s.calendarOverrides);
}

/** The Owner's entry for a day, if any. */
export function overrideFor(iso: string, s: CalendarSettings = calendarDefaults()): DayOverride | null {
  return overrides(s).get(iso) ?? null;
}

function shabbosOrYomTov(iso: string) {
  const k = kinds(iso).kinds;
  return k.has("shabbos") || k.has("yomtov");
}

export type DayInfo = {
  date: string;
  hebrew: string;
  hebrewHe: string;
  names: string[];
  /** Ashkenazi English names (phone line) and Hebrew-letter names (staff screens), same order as names */
  namesEn: string[];
  namesYi: string[];
  /** Why the day is closed, as said on the phone line (Ashkenazi English) and shown on staff screens (Hebrew letters) */
  reasonEn: string | null;
  reasonYi: string | null;
  /** Closed for the whole day (no deliveries, pickups or bookings for that day). */
  closed: boolean;
  reason: string | null;
  /** Erev Shabbos / Erev Yom Tov: open in the morning, closes at this time. */
  closesAt: Date | null;
  closesAtLabel: string | null;
  /** On a Shabbos/Yom Tov day followed by an open day: reopens this evening (after tzeis). */
  reopensAt: Date | null;
};

function reasonFor(k: Set<Kind>, names: string[], alt: string[] = names): string {
  if (k.has("yomtov")) {
    const i = names.findIndex((n) => !/^Erev|Shabbos/.test(n));
    return i >= 0 ? alt[i] : alt === names ? "Yom Tov" : "יום טוב";
  }
  if (k.has("shabbos")) return alt[names.indexOf("Shabbos")] ?? "Shabbos";
  return alt[0] ?? "Closed";
}

function fullClosed(iso: string, s: CalendarSettings): { closed: boolean; reason: string | null } {
  const o = overrides(s).get(iso);
  if (o) return { closed: !o.open, reason: o.open ? null : o.note || "Closed by the owner" };
  if (!yes(s.calendarEnabled)) return { closed: false, reason: null };
  const { kinds: k, names } = kinds(iso);
  const closed =
    k.has("shabbos") ||
    k.has("yomtov") ||
    (k.has("cholHamoed") && yes(s.closeCholHamoed)) ||
    (k.has("chanukah") && yes(s.closeChanukah)) ||
    (k.has("purim") && yes(s.closePurim)) ||
    (k.has("tishaBav") && yes(s.closeTishaBav)) ||
    (k.has("minorFast") && yes(s.closeMinorFasts)) ||
    (k.has("lagBaomer") && yes(s.closeLagBaomer));
  return { closed, reason: closed ? reasonFor(k, names) : null };
}

function fmt(d: Date) {
  return d.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

/** Everything about one calendar day. */
export function dayInfo(iso: string, s: CalendarSettings = calendarDefaults()): DayInfo {
  const hd = hebrewFromISO(iso);
  const { kinds: k, names, namesEn, namesYi } = kinds(iso);
  const today = fullClosed(iso, s);
  // Owner overrides keep their own note; calendar closures get the approved holiday names
  const byCalendar = today.closed && today.reason === reasonFor(k, names);
  const reasonEn = !today.closed ? null : byCalendar ? reasonFor(k, names, namesEn) : today.reason;
  const reasonYi = !today.closed ? null : byCalendar ? reasonFor(k, names, namesYi) : today.reason;
  let closesAt: Date | null = null;
  let closesAtLabel: string | null = null;
  let reopensAt: Date | null = null;
  const z = zmanim(iso, s);
  const tomorrow = addDaysISO(iso, 1);
  if (!today.closed && yes(s.calendarEnabled) && !overrides(s).get(iso)?.open && shabbosOrYomTov(tomorrow) && !fullClosed(iso, { ...s, calendarOverrides: "" }).closed) {
    const isShabbos = weekday(tomorrow) === 6 && !kinds(tomorrow).kinds.has("yomtov");
    const mode = isShabbos ? s.erevShabbosClose : s.erevYomTovClose;
    closesAt = mode === "candles" ? new Date(z.sunset().getTime() - (Number(s.candleLightingMinutes) || 18) * 60_000) : z.chatzot();
    closesAtLabel = `${isShabbos ? "Erev Shabbos" : "Erev Yom Tov"}: closes at ${mode === "candles" ? "candle lighting" : "chatzos"} (${fmt(closesAt)})`;
  }
  if (today.closed && shabbosOrYomTov(iso) && !fullClosed(tomorrow, s).closed) {
    reopensAt = /^\d+$/.test(s.reopenAfter.trim()) ? new Date(z.sunset().getTime() + Number(s.reopenAfter) * 60_000) : z.tzeit(8.5);
  }
  return {
    date: iso,
    hebrew: renderEnglish(hd),
    hebrewHe: renderHebrew(hd),
    names,
    namesEn,
    namesYi,
    closed: today.closed,
    reason: today.reason,
    reasonEn,
    reasonYi,
    closesAt,
    closesAtLabel,
    reopensAt,
  };
}

/** Candle lighting on Erev Shabbos / Erev Yom Tov (Monroe, NY 10950 zmanim), or null on other days. */
export function erevCandleLighting(iso: string, s: CalendarSettings = calendarDefaults()): Date | null {
  if (!shabbosOrYomTov(addDaysISO(iso, 1)) || shabbosOrYomTov(iso)) return null;
  return new Date(zmanim(iso, s).sunset().getTime() - (Number(s.candleLightingMinutes) || 18) * 60_000);
}

/** Today is Shabbos or Yom Tov (nothing rings). */
export const isShabbosOrYomTov = (iso: string) => shabbosOrYomTov(iso);

/** First day on or after `iso` that is not closed all day. */
export function nextOpenDay(iso: string, s: CalendarSettings = calendarDefaults()): string {
  let d = iso;
  for (let i = 0; i < 60; i++) {
    if (!dayInfo(d, s).closed) return d;
    d = addDaysISO(d, 1);
  }
  return d;
}

/** Is the business open at this moment (hotline greeting)? */
export function openNow(at: Date = new Date(), s: CalendarSettings = calendarDefaults()): { open: boolean; reason: string | null; reopensAt: Date | null } {
  const iso = localISO(at);
  const info = dayInfo(iso, s);
  if (info.closed) {
    if (info.reopensAt && at >= info.reopensAt) return { open: true, reason: null, reopensAt: null };
    return { open: false, reason: info.reason, reopensAt: info.reopensAt };
  }
  if (info.closesAt && at >= info.closesAt) {
    const tomorrow = dayInfo(addDaysISO(iso, 1), s);
    return { open: false, reason: tomorrow.reason ?? info.closesAtLabel, reopensAt: tomorrow.reopensAt };
  }
  return { open: true, reason: null, reopensAt: null };
}

export type BookingCheck = { ok: boolean; message: string | null; pickupWarning: string | null; suggestedPickup: string | null; day: DayInfo };

/** Can an event (delivery) day be booked? Flags a pickup ("next day") that falls on a closed day. */
export function checkEventDate(iso: string, s: CalendarSettings = calendarDefaults()): BookingCheck {
  const day = dayInfo(iso, s);
  if (day.closed) return { ok: false, message: `We're closed on that day (${day.reason}).`, pickupWarning: null, suggestedPickup: null, day };
  const pickup = addDaysISO(iso, 1);
  const p = dayInfo(pickup, s);
  if (p.closed) {
    const next = nextOpenDay(pickup, s);
    return { ok: true, message: null, pickupWarning: `The next day (${pickup}) is ${p.reason}, so pickup can't be that day. Next open day: ${next}.`, suggestedPickup: next, day };
  }
  return { ok: true, message: null, pickupWarning: null, suggestedPickup: null, day };
}
