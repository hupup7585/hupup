import { KISLEV, fixedFromISO, toFixed, fromFixed } from "./hebrew-date";
import { holidaysOn, type Holiday } from "./holidays";

/**
 * Every Yom Tov and holiday name for a day, in English, for the Admin calendars (Abraham, Nov 17, 2026: "add to
 * Calendar all Yom Tovim names, meaning Hanukkah, which day Hanukkah is now"). Diaspora, Ashkenazi spelling.
 * Chanukah shows its day ("Chanukah, day 3"); two-day Yom Tov shows day 1 / day 2; Chol Hamoed names its Yom Tov.
 * Shabbes is not listed (every Saturday is already marked).
 */
const ROMAN_NUM: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

function nameFor(h: Holiday, iso: string): string | null {
  const k = h.key;
  if (k.startsWith("Rosh Hashana ") && /\d{4}$/.test(k)) return "Rosh Hashanah, day 1";
  if (k === "Rosh Hashana II") return "Rosh Hashanah, day 2";
  if (k === "Erev Rosh Hashana") return "Erev Rosh Hashanah";
  if (k === "Rosh Hashana LaBehemot") return null; // also Rosh Chodesh Elul; not a business day name
  if (k === "Tzom Gedaliah") return "Tzom Gedalyah";
  if (k === "Erev Yom Kippur") return "Erev Yom Kippur";
  if (k === "Yom Kippur") return "Yom Kippur";
  if (k === "Erev Sukkot") return "Erev Sukkos";
  if (k === "Sukkot VII (Hoshana Raba)") return "Hoshana Rabbah";
  let m = /^Sukkot (I{1,3}|IV|V|VI)( \(CH''M\))?$/.exec(k);
  if (m) return m[2] ? "Chol Hamoed Sukkos" : `Sukkos, day ${ROMAN_NUM[m[1]]}`;
  if (k === "Shmini Atzeret") return "Shemini Atzeres";
  if (k === "Simchat Torah") return "Simchas Torah";
  if (k.startsWith("Chanukah")) {
    // Day 1 is 25 Kislev; the evening before (24 Kislev) is the first candle
    const rd = fixedFromISO(iso);
    const day = rd - toFixed({ year: fromFixed(rd).year, month: KISLEV, day: 25 }) + 1;
    return day >= 1 && day <= 8 ? `Chanukah, day ${day}` : "Erev Chanukah (first candle tonight)";
  }
  if (k === "Chag HaBanot") return null;
  if (k === "Asara B'Tevet") return "Asara B'Teves";
  if (k === "Tu BiShvat") return "Tu B'Shvat";
  if (k === "Purim Katan") return "Purim Koton";
  if (k === "Shushan Purim Katan") return "Shushan Purim Koton";
  if (k === "Ta'anit Esther") return "Taanis Esther";
  if (k === "Erev Purim") return "Erev Purim";
  if (k === "Purim") return "Purim";
  if (k === "Shushan Purim") return "Shushan Purim";
  if (k === "Purim Meshulash") return "Purim Meshulash";
  if (k === "Ta'anit Bechorot") return "Taanis Bechoros";
  if (k === "Erev Pesach") return "Erev Pesach";
  m = /^Pesach (I{1,3}|IV|V|VI|VII|VIII)( \(CH''M\))?$/.exec(k);
  if (m) return m[2] ? "Chol Hamoed Pesach" : `Pesach, day ${ROMAN_NUM[m[1]]}`;
  if (k === "Birkat Hachamah") return "Birkas Hachamah";
  if (k === "Pesach Sheni") return "Pesach Sheni";
  if (k === "Lag BaOmer") return "Lag Ba'Omer";
  if (k === "Erev Shavuot") return "Erev Shavuos";
  if (k === "Shavuot I") return "Shavuos, day 1";
  if (k === "Shavuot II") return "Shavuos, day 2";
  if (k === "Tzom Tammuz") return "Shiva Asar B'Tammuz";
  if (k === "Erev Tish'a B'Av") return "Erev Tisha B'Av";
  if (k === "Tish'a B'Av" || k === "Tish'a B'Av (observed)") return "Tisha B'Av";
  if (k === "Tu B'Av") return "Tu B'Av";
  if (k === "Leil Selichot") return "Selichos (tonight)";
  return h.name;
}

/** The English names for one day (YYYY-MM-DD), most important first; [] on an ordinary day. */
export function dayHolidayNames(iso: string): string[] {
  const out: string[] = [];
  for (const h of holidaysOn(fixedFromISO(iso))) {
    const n = nameFor(h, iso);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
