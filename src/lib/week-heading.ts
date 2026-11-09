/**
 * Clean date-range headings for staff screens (Abraham):
 *   Week of Parshas Toldos  (פרשת תולדות)
 *   From: Sunday, November 8, 2026  ·  זונטאג, כ״ח חשון
 *   To: Shabbos, November 14, 2026  ·  שבת קודש, ד׳ כסלו
 * English first; the Yiddish/Hebrew part is kept separate (rendered right-to-left in its own span).
 */
import { PARSHIYOS, parshaForDate, shabbosIso } from "@/lib/hup-calendar/parsha";
import { hebrewDate } from "@/lib/dual-date";
import { DAY_YI } from "@/lib/yiddish-day";

/** English (Ashkenazi) names, same order as PARSHIYOS. */
export const PARSHIYOS_EN = [
  "Bereishis", "Noach", "Lech Lecha", "Vayeira", "Chayei Sarah", "Toldos", "Vayeitzei", "Vayishlach", "Vayeishev", "Mikeitz", "Vayigash", "Vayechi",
  "Shemos", "Va'eira", "Bo", "Beshalach", "Yisro", "Mishpatim", "Terumah", "Tetzaveh", "Ki Sisa", "Vayakhel", "Pekudei",
  "Vayikra", "Tzav", "Shemini", "Tazria", "Metzora", "Acharei Mos", "Kedoshim", "Emor", "Behar", "Bechukosai",
  "Bamidbar", "Nasso", "Beha'aloscha", "Shelach", "Korach", "Chukas", "Balak", "Pinchas", "Matos", "Masei",
  "Devarim", "Va'eschanan", "Eikev", "Re'eh", "Shoftim", "Ki Seitzei", "Ki Savo", "Nitzavim", "Vayeilech", "Ha'azinu",
] as const;

const YOM_TOV_EN: Record<string, string> = {
  "ראש השנה": "Rosh Hashanah",
  "יום כיפור": "Yom Kippur",
  "סוכות": "Sukkos",
  "חול המועד סוכות": "Chol Hamoed Sukkos",
  "שמיני עצרת": "Shemini Atzeres",
  "שמחת תורה": "Simchas Torah",
  "פסח": "Pesach",
  "חול המועד פסח": "Chol Hamoed Pesach",
  "שבועות": "Shavuos",
};

/** "פרשת תולדות" -> "Parshas Toldos"; "פרשת ויקהל-פקודי" -> "Parshas Vayakhel-Pekudei"; Yom Tov -> its English name. */
export function parshaEnglish(he: string): string {
  if (YOM_TOV_EN[he]) return YOM_TOV_EN[he];
  const names = he.replace(/^פרשת /, "").split("-");
  const en = names.map((n) => PARSHIYOS_EN[(PARSHIYOS as readonly string[]).indexOf(n)] ?? n);
  return `Parshas ${en.join("-")}`;
}

const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Shabbos"];
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** "Sunday, November 8, 2026" (Saturday is "Shabbos"). */
export function englishFullDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  return `${DAY_EN[weekday(iso)]}, ${md}`;
}

/** "זונטאג, כ״ח חשון" */
export function yiddishFullDate(iso: string): string {
  return `${DAY_YI[weekday(iso)]}, ${hebrewDate(iso, { year: false })}`;
}

export type WeekLine = { en: string; he: string };
export type RangeHeading = { week: WeekLine; from: WeekLine; to: WeekLine };

/** The parsha line once for the range: one week -> "Week of Parshas Toldos"; several -> "Weeks of Parshas Toldos to Parshas Vayishlach". */
export function rangeHeading(from: string, to: string): RangeHeading {
  const first = parshaForDate(from);
  const last = parshaForDate(to);
  const oneWeek = shabbosIso(from) === shabbosIso(to);
  const week: WeekLine = oneWeek
    ? { en: `Week of ${parshaEnglish(first)}`, he: first }
    : { en: `Weeks of ${parshaEnglish(first)} to ${parshaEnglish(last)}`, he: `${first} – ${last}` };
  return { week, from: { en: englishFullDate(from), he: yiddishFullDate(from) }, to: { en: englishFullDate(to), he: yiddishFullDate(to) } };
}
