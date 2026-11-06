import { ADAR, ADAR2, AV, ELUL, IYAR, KISLEV, NISAN, SIVAN, TAMUZ, TEVES, TISHREI, daysInMonth, fromFixed, isLeapYear, newYear, toFixed, weekday, SHVAT } from "./hebrew-date";

/**
 * Diaspora holiday rules (two-day Yom Tov), written in-house.
 *
 * `name` is the English name staff and callers get today (unchanged). `proposedEn` / `proposedYi` are the new
 * English and Yiddish names, waiting for Abraham's approval before anyone sees them.
 */
export type HolidayFlag = "CHAG" | "CHOL_HAMOED" | "MINOR_FAST" | "MAJOR_FAST" | "MINOR_HOLIDAY" | "EREV";
export type Holiday = {
  /** Stable key (plain apostrophes), used by the business rules */
  key: string;
  /** English name shown today (unchanged) */
  name: string;
  flags: HolidayFlag[];
  /** Proposed names, not shown anywhere until approved */
  proposedEn?: string;
  proposedYi?: string;
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Proposed English / Yiddish names for the days that matter to the business. */
export const PROPOSED_NAMES = {
  shabbos: { en: "Shabbos", yi: "שבת" },
  erevShabbos: { en: "Erev Shabbos", yi: "ערב שבת" },
  erevYomTov: { en: "Erev Yom Tov", yi: "ערב יום טוב" },
  chatzos: { en: "Chatzos", yi: "חצות" },
  roshHashanah: { en: "Rosh Hashanah", yi: "ראש השנה" },
  yomKippur: { en: "Yom Kippur", yi: "יום כיפור" },
  sukkos: { en: "Sukkos", yi: "סוכות" },
  sheminiAtzeres: { en: "Shemini Atzeres", yi: "שמיני עצרת" },
  simchasTorah: { en: "Simchas Torah", yi: "שמחת תורה" },
  cholHamoed: { en: "Chol Hamoed", yi: "חול המועד" },
  chanukah: { en: "Chanukah", yi: "חנוכה" },
  purim: { en: "Purim", yi: "פורים" },
  tishaBav: { en: "Tisha B'Av", yi: "תשעה באב" },
  lagBaomer: { en: "Lag Ba'Omer", yi: "ל״ג בעומר" },
  pesach: { en: "Pesach", yi: "פסח" },
  shavuos: { en: "Shavuos", yi: "שבועות" },
} as const;
const P = PROPOSED_NAMES;

type Placed = { rd: number; order: number; h: Holiday };

/** Birkas Hachamah: every 28 solar years (Shmuel's 365.25-day year), on the day of 2009-04-08's cycle. */
const BIRKAS_HACHAMAH_ANCHOR = 733505; // R.D. of 2009-04-08
const BIRKAS_HACHAMAH_CYCLE = 10227; // 28 x 365.25 days

/** Every holiday that starts in Hebrew year y (1 Tishrei y to 29 Elul y). */
function yearHolidays(y: number): Placed[] {
  const out: Placed[] = [];
  let order = 0;
  const at = (month: number, day: number) => toFixed({ year: y, month, day });
  const add = (rd: number, h: Holiday) => out.push({ rd, order: order++, h });
  const adar = isLeapYear(y) ? ADAR2 : ADAR;
  const sat = (rd: number) => weekday(rd) === 6;

  // Tishrei
  add(at(TISHREI, 1), { key: `Rosh Hashana ${y}`, name: `Rosh Hashana ${y}`, flags: ["CHAG"], proposedEn: P.roshHashanah.en, proposedYi: P.roshHashanah.yi });
  add(at(TISHREI, 2), { key: "Rosh Hashana II", name: "Rosh Hashana II", flags: ["CHAG"], proposedEn: P.roshHashanah.en, proposedYi: P.roshHashanah.yi });
  add(sat(at(TISHREI, 3)) ? at(TISHREI, 4) : at(TISHREI, 3), { key: "Tzom Gedaliah", name: "Tzom Gedaliah", flags: ["MINOR_FAST"] });
  add(at(TISHREI, 9), { key: "Erev Yom Kippur", name: "Erev Yom Kippur", flags: ["EREV"], proposedEn: P.erevYomTov.en, proposedYi: P.erevYomTov.yi });
  add(at(TISHREI, 10), { key: "Yom Kippur", name: "Yom Kippur", flags: ["CHAG", "MAJOR_FAST"], proposedEn: P.yomKippur.en, proposedYi: P.yomKippur.yi });
  add(at(TISHREI, 14), { key: "Erev Sukkot", name: "Erev Sukkos", flags: ["EREV"], proposedEn: P.erevYomTov.en, proposedYi: P.erevYomTov.yi });
  for (let d = 15; d <= 21; d++) {
    const n = d - 14;
    if (n <= 2) add(at(TISHREI, d), { key: `Sukkot ${ROMAN[n]}`, name: `Sukkos ${ROMAN[n]}`, flags: ["CHAG"], proposedEn: P.sukkos.en, proposedYi: P.sukkos.yi });
    else if (n < 7) add(at(TISHREI, d), { key: `Sukkot ${ROMAN[n]} (CH''M)`, name: `Sukkos ${ROMAN[n]} (CH’’M)`, flags: ["CHOL_HAMOED"], proposedEn: P.cholHamoed.en, proposedYi: P.cholHamoed.yi });
    else add(at(TISHREI, d), { key: "Sukkot VII (Hoshana Raba)", name: "Sukkos VII (Hoshana Raba)", flags: ["CHOL_HAMOED"], proposedEn: P.cholHamoed.en, proposedYi: P.cholHamoed.yi });
  }
  add(at(TISHREI, 22), { key: "Shmini Atzeret", name: "Shmini Atzeres", flags: ["CHAG"], proposedEn: P.sheminiAtzeres.en, proposedYi: P.sheminiAtzeres.yi });
  add(at(TISHREI, 23), { key: "Simchat Torah", name: "Simchas Torah", flags: ["CHAG"], proposedEn: P.simchasTorah.en, proposedYi: P.simchasTorah.yi });

  // Chanukah: first candle the evening of 24 Kislev, eight days from 25 Kislev
  const c1 = at(KISLEV, 24);
  add(c1, { key: "Chanukah: 1 Candle", name: "Chanukah: 1 Candle", flags: ["MINOR_HOLIDAY", "EREV"], proposedEn: P.chanukah.en, proposedYi: P.chanukah.yi });
  const chagHaBanot = daysInMonth(KISLEV, y) === 30 ? at(KISLEV, 30) : at(TEVES, 1);
  for (let n = 2; n <= 8; n++) {
    if (c1 + n - 1 === chagHaBanot) add(chagHaBanot, { key: "Chag HaBanot", name: "Chag HaBanot", flags: ["MINOR_HOLIDAY"] });
    add(c1 + n - 1, { key: `Chanukah: ${n} Candles`, name: `Chanukah: ${n} Candles`, flags: ["MINOR_HOLIDAY"], proposedEn: P.chanukah.en, proposedYi: P.chanukah.yi });
  }
  add(c1 + 8, { key: "Chanukah: 8th Day", name: "Chanukah: 8th Day", flags: ["MINOR_HOLIDAY"], proposedEn: P.chanukah.en, proposedYi: P.chanukah.yi });
  add(at(TEVES, 10), { key: "Asara B'Tevet", name: "Asara B’Teves", flags: ["MINOR_FAST"] });

  // Shvat and Adar
  add(at(SHVAT, 15), { key: "Tu BiShvat", name: "Tu BiShvat", flags: ["MINOR_HOLIDAY"] });
  if (isLeapYear(y)) {
    add(at(ADAR, 14), { key: "Purim Katan", name: "Purim Koton", flags: ["MINOR_HOLIDAY"] });
    add(at(ADAR, 15), { key: "Shushan Purim Katan", name: "Shushan Purim Koton", flags: ["MINOR_HOLIDAY"] });
  }
  add(sat(at(adar, 13)) ? at(adar, 11) : at(adar, 13), { key: "Ta'anit Esther", name: "Ta’anis Esther", flags: ["MINOR_FAST"] });
  add(at(adar, 13), { key: "Erev Purim", name: "Erev Purim", flags: ["MINOR_HOLIDAY", "EREV"] });
  add(at(adar, 14), { key: "Purim", name: "Purim", flags: ["MINOR_HOLIDAY"], proposedEn: P.purim.en, proposedYi: P.purim.yi });
  add(at(adar, 15), { key: "Shushan Purim", name: "Shushan Purim", flags: ["MINOR_HOLIDAY"] });
  if (sat(at(adar, 15))) add(at(adar, 16), { key: "Purim Meshulash", name: "Purim Meshulash", flags: ["MINOR_HOLIDAY"] });

  // Nisan to Elul
  add(sat(at(NISAN, 14)) ? at(NISAN, 12) : at(NISAN, 14), { key: "Ta'anit Bechorot", name: "Ta’anis Bechoros", flags: ["MINOR_FAST"] });
  add(at(NISAN, 14), { key: "Erev Pesach", name: "Erev Pesach", flags: ["EREV"], proposedEn: P.erevYomTov.en, proposedYi: P.erevYomTov.yi });
  for (let d = 15; d <= 22; d++) {
    const n = d - 14;
    const chm = n >= 3 && n <= 6;
    add(at(NISAN, d), chm
      ? { key: `Pesach ${ROMAN[n]} (CH''M)`, name: `Pesach ${ROMAN[n]} (CH’’M)`, flags: ["CHOL_HAMOED"], proposedEn: P.cholHamoed.en, proposedYi: P.cholHamoed.yi }
      : { key: `Pesach ${ROMAN[n]}`, name: `Pesach ${ROMAN[n]}`, flags: ["CHAG"], proposedEn: P.pesach.en, proposedYi: P.pesach.yi });
  }
  // Birkas Hachamah can fall in Adar II, Nisan or later as the solar date drifts; look across the whole year
  const yStart = newYear(y), yEnd = newYear(y + 1);
  const firstBH = yStart + ((((BIRKAS_HACHAMAH_ANCHOR - yStart) % BIRKAS_HACHAMAH_CYCLE) + BIRKAS_HACHAMAH_CYCLE) % BIRKAS_HACHAMAH_CYCLE);
  if (firstBH < yEnd) add(firstBH, { key: "Birkat Hachamah", name: "Birkas Hachamah", flags: ["MINOR_HOLIDAY"] });
  add(at(IYAR, 14), { key: "Pesach Sheni", name: "Pesach Sheni", flags: ["MINOR_HOLIDAY"] });
  add(at(IYAR, 18), { key: "Lag BaOmer", name: "Lag BaOmer", flags: ["MINOR_HOLIDAY"], proposedEn: P.lagBaomer.en, proposedYi: P.lagBaomer.yi });
  add(at(SIVAN, 5), { key: "Erev Shavuot", name: "Erev Shavuos", flags: ["EREV"], proposedEn: P.erevYomTov.en, proposedYi: P.erevYomTov.yi });
  add(at(SIVAN, 6), { key: "Shavuot I", name: "Shavuos I", flags: ["CHAG"], proposedEn: P.shavuos.en, proposedYi: P.shavuos.yi });
  add(at(SIVAN, 7), { key: "Shavuot II", name: "Shavuos II", flags: ["CHAG"], proposedEn: P.shavuos.en, proposedYi: P.shavuos.yi });
  add(sat(at(TAMUZ, 17)) ? at(TAMUZ, 18) : at(TAMUZ, 17), { key: "Tzom Tammuz", name: "Tzom Tammuz", flags: ["MINOR_FAST"] });
  const av9 = at(AV, 9);
  const fast = sat(av9) ? av9 + 1 : av9;
  add(fast - 1, { key: "Erev Tish'a B'Av", name: "Erev Tish’a B’Av", flags: ["MAJOR_FAST", "EREV"] });
  add(fast, sat(av9)
    ? { key: "Tish'a B'Av (observed)", name: "Tish’a B’Av (observed)", flags: ["MAJOR_FAST"], proposedEn: P.tishaBav.en, proposedYi: P.tishaBav.yi }
    : { key: "Tish'a B'Av", name: "Tish’a B’Av", flags: ["MAJOR_FAST"], proposedEn: P.tishaBav.en, proposedYi: P.tishaBav.yi });
  add(at(AV, 15), { key: "Tu B'Av", name: "Tu B’Av", flags: ["MINOR_HOLIDAY"] });
  add(at(ELUL, 1), { key: "Rosh Hashana LaBehemot", name: "Rosh Hashana LaBehemot", flags: ["MINOR_HOLIDAY"] });
  // Leil Selichos: the Saturday night before Rosh Hashanah, at least four days before it
  const nextRH = newYear(y + 1);
  let selichos = nextRH - 1 - ((weekday(nextRH - 1) + 1) % 7);
  if (nextRH - selichos < 4) selichos -= 7;
  add(selichos, { key: "Leil Selichot", name: "Leil Selichos", flags: ["MINOR_HOLIDAY"] });
  add(nextRH - 1, { key: "Erev Rosh Hashana", name: "Erev Rosh Hashana", flags: ["EREV"], proposedEn: P.erevYomTov.en, proposedYi: P.erevYomTov.yi });
  return out;
}

const yearCache = new Map<number, Map<number, Holiday[]>>();
function byDay(y: number): Map<number, Holiday[]> {
  let m = yearCache.get(y);
  if (!m) {
    m = new Map();
    for (const p of yearHolidays(y).sort((a, b) => a.rd - b.rd || a.order - b.order)) {
      const list = m.get(p.rd) ?? [];
      list.push(p.h);
      m.set(p.rd, list);
    }
    yearCache.set(y, m);
  }
  return m;
}

/** Holidays on an R.D. day (diaspora). */
export function holidaysOn(rd: number): Holiday[] {
  const y = fromFixed(rd).year;
  return [...(byDay(y).get(rd) ?? []), ...(byDay(y - 1).get(rd) ?? [])];
}
