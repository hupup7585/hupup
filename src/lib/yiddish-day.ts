/**
 * Yiddish day names and the week's parsha for staff screens (Abraham Y, Z, AA, BB). Screens only: never on the phone
 * line, the public website, texts or emails.
 *
 *  Plain day:   "זונטאג, פרשת חיי שרה"   (Saturday: "שבת קודש, פרשת ...")
 *  A moment:    after Shabbos ends in Monroe (tzeis, 8.5 degrees, as hebcal's havdalah) Saturday shows
 *               "מוצאי שבת קודש, פרשת <next week>".
 *  Call log:    the day changes at 6:00 AM New York time. Before 6 AM = the previous day's night ("ביינאכט"),
 *               6 AM to noon = "אינדערפרי", then the plain day name. Saturday night / before 6 AM Sunday after
 *               Shabbos ends = "מוצאי שבת קודש".
 */
import { zmanim } from "@/lib/hup-calendar/zmanim";
import { parshaForDate } from "@/lib/hup-calendar/parsha";

export const DAY_YI = ["זונטאג", "מאנטאג", "דינסטאג", "מיטוואך", "דאנערשטאג", "פרייטאג", "שבת קודש"] as const;
export const MOTZEI_SHABBOS = "מוצאי שבת קודש";
export const NIGHT = "ביינאכט";
export const MORNING = "אינדערפרי";
export const DAY_START_HOUR = 6;

const TZ = "America/New_York";
/** Monroe, NY (the business's calendar location). */
const MONROE = { latitude: 41.3407, longitude: -74.1679 };

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const addDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function nyParts(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { iso: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** When Shabbos ends on this Saturday (tzeis 8.5 degrees in Monroe). */
export function shabbosEnds(saturdayIso: string): Date {
  return zmanim(saturdayIso, MONROE).tzeis(8.5);
}

/** A plain calendar day: "זונטאג, פרשת חיי שרה". */
export function yiddishDay(iso: string): string {
  return `${DAY_YI[weekdayOf(iso)]}, ${parshaForDate(iso)}`;
}

/** Right now / a moment: like yiddishDay, but Saturday after Shabbos ends is Motzei Shabbos with next week's parsha. */
export function yiddishMoment(at: Date): string {
  const { iso } = nyParts(at);
  if (weekdayOf(iso) === 6 && at.getTime() >= shabbosEnds(iso).getTime()) return `${MOTZEI_SHABBOS}, ${parshaForDate(addDay(iso, 1))}`;
  return yiddishDay(iso);
}

export type CallDay = { day: string; part: "night" | "morning" | null; label: string; parsha: string };

/** Call log (BB): the Yiddish day of a call, with the day turning over at 6:00 AM. */
export function yiddishCallDay(at: Date): CallDay {
  const { iso, hour } = nyParts(at);
  if (hour < DAY_START_HOUR) {
    const prev = addDay(iso, -1);
    // Saturday night after Shabbos (and before 6 AM Sunday): Motzei Shabbos, next week's parsha
    if (weekdayOf(prev) === 6 && at.getTime() >= shabbosEnds(prev).getTime()) return { day: MOTZEI_SHABBOS, part: "night", label: MOTZEI_SHABBOS, parsha: parshaForDate(iso) };
    return { day: DAY_YI[weekdayOf(prev)], part: "night", label: `${DAY_YI[weekdayOf(prev)]} ${NIGHT}`, parsha: parshaForDate(prev) };
  }
  if (weekdayOf(iso) === 6 && at.getTime() >= shabbosEnds(iso).getTime()) return { day: MOTZEI_SHABBOS, part: "night", label: MOTZEI_SHABBOS, parsha: parshaForDate(addDay(iso, 1)) };
  if (hour < 12) return { day: DAY_YI[weekdayOf(iso)], part: "morning", label: `${DAY_YI[weekdayOf(iso)]} ${MORNING}`, parsha: parshaForDate(iso) };
  return { day: DAY_YI[weekdayOf(iso)], part: null, label: DAY_YI[weekdayOf(iso)], parsha: parshaForDate(iso) };
}
