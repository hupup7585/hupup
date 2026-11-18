import { KISLEV, fixedFromISO, toFixed, fromFixed } from "./hebrew-date";
import { chanukahDayYi, holidaysOn, type Holiday } from "./holidays";

/**
 * Every Yom Tov and holiday name for a day, for the Admin calendars (Abraham, Nov 17-18, 2026: "add to Calendar all
 * Yom Tovim names, meaning Hanukkah, which day Hanukkah is now"; "change it to Hebrew, leave in parentheses the
 * English"). Hebrew first, e.g. "ג׳ דחנוכה (Chanukah, day 3)". Diaspora, Ashkenazi spelling. Shabbes is not listed
 * (every Saturday is already marked). Chag HaBanot, a Sephardic custom, is left out.
 */
export type DayName = { he: string; en: string };

const DAY = "אבגדהוזח";
const nth = (n: number, he: string) => `${DAY[n - 1]}׳ ד${he}`;
const ROMAN_NUM: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

const FIXED: Record<string, DayName> = {
  "Rosh Hashana II": { he: nth(2, "ראש השנה"), en: "Rosh Hashanah, day 2" },
  "Erev Rosh Hashana": { he: "ערב ראש השנה", en: "Erev Rosh Hashanah" },
  "Tzom Gedaliah": { he: "צום גדליה", en: "Tzom Gedalyah" },
  "Erev Yom Kippur": { he: "ערב יום כיפור", en: "Erev Yom Kippur" },
  "Yom Kippur": { he: "יום כיפור", en: "Yom Kippur" },
  "Erev Sukkot": { he: "ערב סוכות", en: "Erev Sukkos" },
  "Sukkot VII (Hoshana Raba)": { he: "הושענא רבה", en: "Hoshana Rabbah" },
  "Shmini Atzeret": { he: "שמיני עצרת", en: "Shemini Atzeres" },
  "Simchat Torah": { he: "שמחת תורה", en: "Simchas Torah" },
  "Asara B'Tevet": { he: "עשרה בטבת", en: "Asara B'Teves" },
  "Tu BiShvat": { he: "ט״ו בשבט", en: "Tu B'Shvat" },
  "Purim Katan": { he: "פורים קטן", en: "Purim Koton" },
  "Shushan Purim Katan": { he: "שושן פורים קטן", en: "Shushan Purim Koton" },
  "Ta'anit Esther": { he: "תענית אסתר", en: "Taanis Esther" },
  "Erev Purim": { he: "ערב פורים", en: "Erev Purim" },
  Purim: { he: "פורים", en: "Purim" },
  "Shushan Purim": { he: "שושן פורים", en: "Shushan Purim" },
  "Purim Meshulash": { he: "פורים המשולש", en: "Purim Meshulash" },
  "Ta'anit Bechorot": { he: "תענית בכורות", en: "Taanis Bechoros" },
  "Erev Pesach": { he: "ערב פסח", en: "Erev Pesach" },
  "Birkat Hachamah": { he: "ברכת החמה", en: "Birkas Hachamah" },
  "Pesach Sheni": { he: "פסח שני", en: "Pesach Sheni" },
  "Lag BaOmer": { he: "ל״ג בעומר", en: "Lag Ba'Omer" },
  "Erev Shavuot": { he: "ערב שבועות", en: "Erev Shavuos" },
  "Shavuot I": { he: nth(1, "שבועות"), en: "Shavuos, day 1" },
  "Shavuot II": { he: nth(2, "שבועות"), en: "Shavuos, day 2" },
  "Tzom Tammuz": { he: "שבעה עשר בתמוז", en: "Shiva Asar B'Tammuz" },
  "Erev Tish'a B'Av": { he: "ערב תשעה באב", en: "Erev Tisha B'Av" },
  "Tish'a B'Av": { he: "תשעה באב", en: "Tisha B'Av" },
  "Tish'a B'Av (observed)": { he: "תשעה באב (נדחה)", en: "Tisha B'Av" },
  "Tu B'Av": { he: "ט״ו באב", en: "Tu B'Av" },
  "Leil Selichot": { he: "סליחות", en: "Selichos (tonight)" },
};

function nameFor(h: Holiday, iso: string): DayName | null {
  const k = h.key;
  if (FIXED[k]) return FIXED[k];
  if (k.startsWith("Rosh Hashana ") && /\d{4}$/.test(k)) return { he: nth(1, "ראש השנה"), en: "Rosh Hashanah, day 1" };
  let m = /^Sukkot (I{1,3}|IV|V|VI)( \(CH''M\))?$/.exec(k);
  if (m) return m[2] ? { he: "חול המועד סוכות", en: "Chol Hamoed Sukkos" } : { he: nth(ROMAN_NUM[m[1]], "סוכות"), en: `Sukkos, day ${ROMAN_NUM[m[1]]}` };
  if (k.startsWith("Chanukah")) {
    // Day 1 is 25 Kislev; the evening before (24 Kislev) is the first candle
    const rd = fixedFromISO(iso);
    const day = rd - toFixed({ year: fromFixed(rd).year, month: KISLEV, day: 25 }) + 1;
    return day >= 1 && day <= 8 ? { he: chanukahDayYi(day), en: `Chanukah, day ${day}` } : { he: "ערב חנוכה", en: "Erev Chanukah, first candle tonight" };
  }
  m = /^Pesach (I{1,3}|IV|V|VI|VII|VIII)( \(CH''M\))?$/.exec(k);
  if (m) {
    const n = ROMAN_NUM[m[1]];
    if (m[2]) return { he: "חול המועד פסח", en: "Chol Hamoed Pesach" };
    return { he: n === 7 ? "שביעי של פסח" : n === 8 ? "אחרון של פסח" : nth(n, "פסח"), en: `Pesach, day ${n}` };
  }
  if (k === "Rosh Hashana LaBehemot") return null; // not a business day name
  return null;
}

/** The names for one day (YYYY-MM-DD), Hebrew and English; [] on an ordinary day. */
export function dayHolidays(iso: string): DayName[] {
  const out: DayName[] = [];
  for (const h of holidaysOn(fixedFromISO(iso))) {
    const n = nameFor(h, iso);
    if (n && !out.some((o) => o.en === n.en)) out.push(n);
  }
  return out;
}

/** "ג׳ דחנוכה (Chanukah, day 3)" for each name of the day. */
export const dayHolidayLabels = (iso: string): string[] => dayHolidays(iso).map((n) => `${n.he} (${n.en})`);

/** The English names only. */
export const dayHolidayNames = (iso: string): string[] => dayHolidays(iso).map((n) => n.en);
