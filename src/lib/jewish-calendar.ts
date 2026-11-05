import { HDate, HebrewCalendar, Location, Zmanim, flags, type Event } from "@hebcal/core";
import type { Settings } from "@/lib/settings";
import { SETTING_DEFAULTS } from "@/lib/settings";

/**
 * Jewish calendar open/closed rules (Abraham, 2026-11-06), shared by the POS, the hotline and booking checks.
 * Offline (@hebcal/core): no API calls. Diaspora (two-day Yom Tov). Zmanim for Monroe / Kiryas Joel, NY.
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
/** Noon on that calendar day (avoids time-zone edge cases when deriving the Hebrew date). */
function noon(iso: string) {
  const { y, m, d } = parts(iso);
  return new Date(y, m - 1, d, 12);
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

function location(s: CalendarSettings) {
  return new Location(Number(s.calendarLatitude) || 41.3407, Number(s.calendarLongitude) || -74.1679, false, TIME_ZONE, "Kiryas Joel, NY");
}
/** Zmanim for a date. Zmanim works from the date's year/month/day, so pass a local-noon Date. */
function zmanim(iso: string, s: CalendarSettings) {
  return new Zmanim(location(s), noon(iso), false);
}

function events(iso: string): Event[] {
  return HebrewCalendar.getHolidaysOnDate(new HDate(noon(iso)), false) ?? [];
}

type Kind = "shabbos" | "yomtov" | "cholHamoed" | "chanukah" | "purim" | "tishaBav" | "minorFast" | "lagBaomer";

function kinds(iso: string): { kinds: Set<Kind>; names: string[] } {
  const k = new Set<Kind>();
  const names: string[] = [];
  if (weekday(iso) === 6) {
    k.add("shabbos");
    names.push("Shabbos");
  }
  for (const e of events(iso)) {
    const f = e.getFlags();
    if (f & flags.YOM_KIPPUR_KATAN) continue; // a minor custom, not a closure; would only confuse staff
    const desc = e.getDesc();
    if (f & flags.CHAG) k.add("yomtov");
    else if (f & flags.CHOL_HAMOED) k.add("cholHamoed");
    if (desc.startsWith("Chanukah")) k.add("chanukah");
    if (desc === "Purim") k.add("purim");
    if (desc.startsWith("Tish'a B'Av")) k.add("tishaBav");
    if (f & flags.MINOR_FAST && desc !== "Ta'anit Bechorot") k.add("minorFast");
    if (desc === "Lag BaOmer") k.add("lagBaomer");
    if (f & (flags.CHAG | flags.CHOL_HAMOED | flags.MINOR_FAST | flags.MAJOR_FAST | flags.MINOR_HOLIDAY | flags.EREV) || desc.startsWith("Chanukah") || desc === "Purim" || desc === "Lag BaOmer")
      names.push(e.render("ashkenazi"));
  }
  return { kinds: k, names };
}

function overrides(s: CalendarSettings): Map<string, { open: boolean; note: string }> {
  const m = new Map<string, { open: boolean; note: string }>();
  for (const line of s.calendarOverrides.split("\n")) {
    const r = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(open|closed)\b\s*(.*)$/i);
    if (r) m.set(r[1], { open: r[2].toLowerCase() === "open", note: r[3] });
  }
  return m;
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
  /** Closed for the whole day (no deliveries, pickups or bookings for that day). */
  closed: boolean;
  reason: string | null;
  /** Erev Shabbos / Erev Yom Tov: open in the morning, closes at this time. */
  closesAt: Date | null;
  closesAtLabel: string | null;
  /** On a Shabbos/Yom Tov day followed by an open day: reopens this evening (after tzeis). */
  reopensAt: Date | null;
};

function reasonFor(k: Set<Kind>, names: string[]): string {
  if (k.has("yomtov")) return names.find((n) => !/^Erev|Shabbos/.test(n)) ?? "Yom Tov";
  if (k.has("shabbos")) return "Shabbos";
  return names[0] ?? "Closed";
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
  const hd = new HDate(noon(iso));
  const { names } = kinds(iso);
  const today = fullClosed(iso, s);
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
    hebrew: hd.render("ashkenazi"),
    hebrewHe: hd.renderGematriya(),
    names,
    closed: today.closed,
    reason: today.reason,
    closesAt,
    closesAtLabel,
    reopensAt,
  };
}

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
