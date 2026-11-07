/**
 * Hup Up Attractions' own Hebrew calendar (written in-house, no outside library).
 *
 * The fixed Hebrew calendar (Hillel II): 19-year cycle with 7 leap years, the molad of Tishrei and the four
 * postponements (dechiyos: Molad Zakein, Lo ADU Rosh, GaTaRaD, BeTUTaKPaT). Days are counted as "R.D." fixed day
 * numbers (day 1 = Monday, January 1, year 1 of the proleptic Gregorian calendar), which makes weekday and
 * Gregorian conversion simple. Valid for any year; the business uses it from now through the end of year 6000.
 *
 * Month numbers: 1 Nisan, 2 Iyar, 3 Sivan, 4 Tamuz, 5 Av, 6 Elul, 7 Tishrei, 8 Cheshvan, 9 Kislev, 10 Teves,
 * 11 Shvat, 12 Adar (Adar I in a leap year), 13 Adar II (leap years only).
 */

export const NISAN = 1, IYAR = 2, SIVAN = 3, TAMUZ = 4, AV = 5, ELUL = 6, TISHREI = 7, CHESHVAN = 8, KISLEV = 9, TEVES = 10, SHVAT = 11, ADAR = 12, ADAR2 = 13;

/** R.D. of 1 Tishrei of year 1 (Monday, October 7, 3761 BCE, Julian). */
const HEBREW_EPOCH = -1373427;
const PARTS_PER_DAY = 25920; // 24 hours x 1080 parts

export type HDay = { year: number; month: number; day: number };

export const isLeapYear = (y: number) => ((7 * y + 1) % 19 + 19) % 19 < 7;
export const monthsInYear = (y: number) => (isLeapYear(y) ? 13 : 12);

/** Days from the epoch to the molad-based Rosh Hashanah, with the Molad Zakein and Lo ADU Rosh postponements. */
function elapsedDays(y: number): number {
  const monthsElapsed = Math.floor((235 * y - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  const day = 29 * monthsElapsed + Math.floor(partsElapsed / PARTS_PER_DAY);
  return (3 * (day + 1)) % 7 < 3 ? day + 1 : day;
}

/** GaTaRaD and BeTUTaKPaT: keep every year length legal (353-355 or 383-385 days). */
function yearLengthCorrection(y: number): number {
  const ny0 = elapsedDays(y - 1), ny1 = elapsedDays(y), ny2 = elapsedDays(y + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
}

const newYearCache = new Map<number, number>();
/** R.D. of 1 Tishrei of year y. */
export function newYear(y: number): number {
  let v = newYearCache.get(y);
  if (v === undefined) {
    v = HEBREW_EPOCH + elapsedDays(y) + yearLengthCorrection(y);
    newYearCache.set(y, v);
  }
  return v;
}

export const daysInYear = (y: number) => newYear(y + 1) - newYear(y);
const longCheshvan = (y: number) => daysInYear(y) % 10 === 5;
const shortKislev = (y: number) => daysInYear(y) % 10 === 3;

export function daysInMonth(month: number, y: number): number {
  if (month === IYAR || month === TAMUZ || month === ELUL || month === TEVES || month === ADAR2) return 29;
  if (month === ADAR && !isLeapYear(y)) return 29;
  if (month === CHESHVAN && !longCheshvan(y)) return 29;
  if (month === KISLEV && shortKislev(y)) return 29;
  return 30;
}

/** R.D. of a Hebrew date. */
export function toFixed({ year, month, day }: HDay): number {
  let n = newYear(year) + day - 1;
  if (month < TISHREI) {
    for (let m = TISHREI; m <= monthsInYear(year); m++) n += daysInMonth(m, year);
    for (let m = NISAN; m < month; m++) n += daysInMonth(m, year);
  } else {
    for (let m = TISHREI; m < month; m++) n += daysInMonth(m, year);
  }
  return n;
}

/** Hebrew date of an R.D. */
export function fromFixed(rd: number): HDay {
  let year = Math.floor((rd - HEBREW_EPOCH) / 365.2468) + 1;
  while (newYear(year) > rd) year--;
  while (newYear(year + 1) <= rd) year++;
  let month = rd < toFixed({ year, month: NISAN, day: 1 }) ? TISHREI : NISAN;
  while (rd > toFixed({ year, month, day: daysInMonth(month, year) })) month++;
  return { year, month, day: rd - toFixed({ year, month, day: 1 }) + 1 };
}

/* ---- Gregorian <-> R.D. (proleptic Gregorian) ---- */

export function fixedFromGregorian(y: number, m: number, d: number): number {
  const y1 = y - 1;
  return 365 * y1 + Math.floor(y1 / 4) - Math.floor(y1 / 100) + Math.floor(y1 / 400) + Math.floor((367 * m - 362) / 12) + (m <= 2 ? 0 : isGregLeap(y) ? -1 : -2) + d;
}
const isGregLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** "YYYY-MM-DD" -> R.D. */
export function fixedFromISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return fixedFromGregorian(y, m, d);
}

/** R.D. -> "YYYY-MM-DD" (via UTC; R.D. 719163 = 1970-01-01). */
export function isoFromFixed(rd: number): string {
  return new Date((rd - 719163) * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Shabbos. */
export const weekday = (rd: number) => ((rd % 7) + 7) % 7;

export const hebrewFromISO = (iso: string) => fromFixed(fixedFromISO(iso));
