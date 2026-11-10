import { ADAR, ADAR2, hebrewFromISO, isLeapYear } from "@/lib/hup-calendar/hebrew-date";
import { gematriya } from "@/lib/hup-calendar/names";
import { zmanim } from "@/lib/hup-calendar/zmanim";

/**
 * Every date shown in both calendars, side by side (Abraham): "Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז".
 * English first, then the Hebrew date with Yiddish month spellings (no vowel points, as in Yiddish calendars).
 * Works in the browser too (no database, no server code). No holidays here: just the two dates.
 */

const TZ = "America/New_York";
/** Kiryas Joel: used only to tell when nightfall starts the next Hebrew day for a time of day. */
const KJ = { latitude: 41.3407, longitude: -74.1679 };

/** Yiddish month names (unpointed). Index = engine month number (1 = Nisan ... 13 = Adar II). */
export const YI_MONTHS: Record<number, string> = {
  1: "ניסן",
  2: "אייר",
  3: "סיון",
  4: "תמוז",
  5: "אב",
  6: "אלול",
  7: "תשרי",
  8: "חשון",
  9: "כסלו",
  10: "טבת",
  11: "שבט",
  12: "אדר",
  13: "אדר ב׳",
};

function yiMonth(month: number, year: number): string {
  if (month === ADAR && isLeapYear(year)) return "אדר א׳";
  if (month === ADAR2) return YI_MONTHS[ADAR2];
  return YI_MONTHS[month];
}

/** "כ״ח חשון תשפ״ז" (year: false -> "כ״ח חשון"). The thousands are left off, as is customary. */
export function hebrewDate(iso: string, opts: { year?: boolean } = {}): string {
  const h = hebrewFromISO(iso);
  const dm = `${gematriya(h.day)} ${yiMonth(h.month, h.year)}`;
  return opts.year === false ? dm : `${dm} ${gematriya(h.year % 1000 === 0 ? h.year / 1000 : h.year % 1000)}`;
}

const asUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** long: "Sunday, Nov 8, 2026"   short: "Sun, Nov 8" */
export function englishDate(iso: string, style: "long" | "short" = "long"): string {
  const o: Intl.DateTimeFormatOptions =
    style === "long" ? { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric" } : { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }; // Abraham: always with the year
  return asUTC(iso).toLocaleDateString("en-US", o);
}

export type DualParts = { en: string; he: string };

/** Both dates for a calendar day. long: full; short (tables): short day and month, English with the year. */
export function dualParts(iso: string, style: "long" | "short" = "long"): DualParts {
  return { en: englishDate(iso, style), he: hebrewDate(iso, { year: style === "long" }) };
}

/** "Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז" (plain text, for texts, emails and titles). */
export function dualDate(iso: string, style: "long" | "short" = "long"): string {
  const p = dualParts(iso, style);
  return `${p.en} / ${p.he}`;
}

/** Civil date (YYYY-MM-DD) of a moment in New York. */
export function localISO(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * The Hebrew day of a moment: the Hebrew day starts at nightfall, so a call at 9 PM on Sunday is already
 * Monday's Hebrew date. Returns the civil date whose daytime Hebrew date applies.
 */
export function hebrewDayISO(at: Date): string {
  const iso = localISO(at);
  try {
    if (at.getTime() >= zmanim(iso, KJ).tzeis(8.5).getTime()) {
      const d = asUTC(iso);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
  } catch {
    /* no sun times: keep the civil date */
  }
  return iso;
}

/** A moment (call, text, voicemail, activity): "Sun, Nov 8, 2026, 9:15 PM" and the Hebrew date in effect then. */
export function dualDateTimeParts(atIn: Date | string): DualParts {
  const at = new Date(atIn);
  const en = at.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return { en, he: hebrewDate(hebrewDayISO(at)) };
}

export function dualDateTime(at: Date | string): string {
  const p = dualDateTimeParts(at);
  return `${p.en} / ${p.he}`;
}

/**
 * Dates inside customer texts and emails (and the owner's paid-order text). OFF until Abraham approves the new
 * wording: Hebrew letters make every text a Unicode text (70 characters per part instead of 160), so texts get
 * longer and cost more parts. Until then messages keep the English date exactly as before.
 */
export const MESSAGE_DUAL_DATES = false;

/** Date for a text or email: "Sunday, November 8" today; "Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז" once approved. */
export function messageDate(iso: string, on: boolean = MESSAGE_DUAL_DATES): string {
  if (on) return dualDate(iso);
  return asUTC(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}
